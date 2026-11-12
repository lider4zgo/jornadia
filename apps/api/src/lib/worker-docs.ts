import {
  biometricConsent,
  fullNotice,
  journeyAgreement,
  simplifiedNotice,
  workerDocVersion,
  type WorkerDoc,
  type WorkerDocContext,
  type WorkerDocKey,
} from '@korporia/core';
import type { Env } from '../env';
import { adminClient, coreDb, jornadaDb } from './supabase';

export type BiometricChoice = 'autorizo' | 'no_autorizo' | 'retiro';

export interface WorkerDocsState {
  /** Documentos que el trabajador debe firmar (o volver a firmar por cambio de versión) */
  pending: WorkerDocKey[];
  /** Última decisión sobre el uso de su rostro */
  biometric: BiometricChoice | null;
  /** Textos vigentes, ya con los datos del patrón y del trabajador */
  docs: { aviso: WorkerDoc; avisoCompleto: WorkerDoc; acuerdo: WorkerDoc | null; biometria: WorkerDoc | null };
  usesJornada: boolean;
}

interface EmployeeRef {
  id: string;
  company_id: string;
  full_name: string;
  employee_number: string;
}

/** Qué documentos debe firmar un trabajador y con qué texto. */
export async function workerDocsState(env: Env, employee: EmployeeRef): Promise<WorkerDocsState> {
  const core = coreDb(adminClient(env));
  const [{ data: company }, { data: modules }, { data: rows }] = await Promise.all([
    core.from('companies').select('name, legal_name, address, privacy_email, privacy_phone').eq('id', employee.company_id).single(),
    core.from('company_modules').select('module_key').eq('company_id', employee.company_id).eq('active', true),
    core
      .from('employee_acceptances')
      .select('document, version, choice, signed_at')
      .eq('employee_id', employee.id)
      .order('signed_at', { ascending: false })
      .limit(50),
  ]);
  const active = new Set((modules ?? []).map((m) => m.module_key as string));
  const ctx: WorkerDocContext = {
    companyName: company?.name ?? 'Tu empresa',
    legalName: company?.legal_name,
    address: company?.address,
    privacyEmail: company?.privacy_email,
    privacyPhone: company?.privacy_phone,
    employeeName: employee.full_name,
    employeeNumber: employee.employee_number,
    usesRecords: active.has('rh'),
    usesPayroll: active.has('nomina'),
  };
  const usesJornada = active.has('jornada');
  const latest = new Map<string, { version: string; choice: string }>();
  for (const r of rows ?? []) if (!latest.has(r.document)) latest.set(r.document, r);

  const required: WorkerDocKey[] = ['aviso_trabajadores', ...(usesJornada ? (['acuerdo_jornada', 'biometria'] as const) : [])];
  const pending = required.filter((d) => latest.get(d)?.version !== workerDocVersion(d, ctx));
  const bio = latest.get('biometria')?.choice as BiometricChoice | undefined;

  return {
    pending,
    biometric: bio ?? null,
    usesJornada,
    docs: {
      aviso: simplifiedNotice(ctx),
      avisoCompleto: fullNotice(ctx),
      acuerdo: usesJornada ? journeyAgreement(ctx) : null,
      biometria: usesJornada ? biometricConsent(ctx) : null,
    },
  };
}

/**
 * Aplica la decisión biométrica en Jornada: con autorización queda el consentimiento;
 * sin ella (o al retirarla) se borra la foto de registro y el trabajador checa con PIN.
 */
export async function applyBiometricChoice(env: Env, employee: { id: string; company_id: string }, choice: BiometricChoice, actorId: string) {
  const db = jornadaDb(adminClient(env));
  const authorized = choice === 'autorizo';
  await db.from('employee_settings').upsert(
    {
      employee_id: employee.id,
      company_id: employee.company_id,
      consent_confirmed_at: authorized ? new Date().toISOString() : null,
      consent_confirmed_by: authorized ? actorId : null,
    },
    { onConflict: 'employee_id' },
  );
  if (!authorized) {
    const { data: face } = await db.from('faces').select('photo_path').eq('employee_id', employee.id).maybeSingle();
    if (face) {
      await db.from('faces').delete().eq('employee_id', employee.id);
      await db.from('employee_settings').update({ face_enrolled_at: null }).eq('employee_id', employee.id);
      await env.FILES.delete(face.photo_path);
    }
  }
}
