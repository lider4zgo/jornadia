// Copia a public/models solo los modelos de rostro que usa Jornadia,
// para servirlos desde nuestro dominio y tenerlos disponibles sin conexión.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// El paquete no exporta package.json; se localiza su carpeta a partir del archivo principal
let humanDir = dirname(require.resolve('@vladmandic/human'));
while (!existsSync(join(humanDir, 'models')) && dirname(humanDir) !== humanDir) humanDir = dirname(humanDir);
const src = join(humanDir, 'models');
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const models = ['blazeface', 'facemesh', 'iris', 'faceres', 'antispoof', 'liveness'];

mkdirSync(dest, { recursive: true });
for (const m of models) {
  for (const ext of ['json', 'bin']) {
    const from = join(src, `${m}.${ext}`);
    if (!existsSync(from)) throw new Error(`Falta el modelo ${m}.${ext}`);
    copyFileSync(from, join(dest, `${m}.${ext}`));
  }
}
console.log(`Modelos de rostro copiados a ${dest}`);
