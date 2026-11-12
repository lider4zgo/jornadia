// Intérprete de las plantillas del tablero de Marketing (formato "Design Component").
// Convierte la plantilla HTML en elementos de Preact y vuelve a pintar con cada setState.
// Soporta lo que usan las páginas del sitio: {{huecos}} en texto y atributos,
// <sc-for list as>, <sc-if value>, eventos onClick/onChange y estilos en línea.
import { h, render } from 'preact';

/** Base de la lógica de cada página (equivalente a DCLogic del tablero). */
export class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    if (this._schedule) this._schedule();
  }
  componentDidMount() {}
  renderVals() {
    return {};
  }
}

const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const SINGLE = /^\s*\{\{\s*([\w$.]+)\s*\}\}\s*$/;
// Campos donde onChange debe reaccionar mientras se escribe o se arrastra (como en React)
const LIVE_INPUTS = new Set(['', 'text', 'email', 'number', 'range', 'search', 'tel', 'url']);

function lookup(scope, path) {
  let v = scope;
  for (const k of path.split('.')) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

/** Un hueco solo devuelve el valor tal cual (función, lista, booleano); mezclado con texto, cadena. */
function interp(str, scope) {
  const m = str.match(SINGLE);
  if (m) return lookup(scope, m[1]);
  return str.replace(HOLE, (_, p) => {
    const v = lookup(scope, p);
    return v == null ? '' : String(v);
  });
}

function children(node, scope, prefix) {
  const out = [];
  node.childNodes.forEach((child, i) => {
    const v = toVNode(child, scope, `${prefix}.${i}`);
    if (Array.isArray(v)) out.push(...v);
    else if (v != null && v !== false) out.push(v);
  });
  return out;
}

function toVNode(node, scope, key) {
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    if (!text.includes('{{')) return text;
    const v = interp(text, scope);
    return v == null || v === false ? '' : String(v);
  }
  if (node.nodeType !== 1) return null;
  const tag = node.localName;

  if (tag === 'sc-for') {
    const list = interp(node.getAttribute('list') || '', scope);
    const as = node.getAttribute('as') || 'item';
    if (!Array.isArray(list)) return null;
    return list.flatMap((item, i) => children(node, Object.assign({}, scope, { [as]: item }), `${key}.${i}`));
  }
  if (tag === 'sc-if') {
    return interp(node.getAttribute('value') || '', scope) ? children(node, scope, key) : null;
  }

  const props = { key };
  for (const attr of node.attributes) {
    let name = attr.name;
    if (name.startsWith('hint-')) continue;
    const value = attr.value.includes('{{') ? interp(attr.value, scope) : attr.value;
    if (/^on[a-z]+$/i.test(name)) {
      if (typeof value !== 'function') continue;
      name = name.toLowerCase();
      if (name === 'onchange' && tag === 'input' && LIVE_INPUTS.has((node.getAttribute('type') || '').toLowerCase())) name = 'oninput';
      props[name] = value;
      continue;
    }
    if (value == null || value === false) continue;
    props[name] = value === true ? '' : value;
  }
  return h(tag, props, ...children(node, scope, key));
}

/** Monta una página: plantilla HTML + clase de lógica, en el elemento indicado. */
export function mount(templateHtml, Component, el) {
  const tpl = document.createElement('template');
  tpl.innerHTML = templateHtml;
  const rootNode = Array.from(tpl.content.childNodes).find((n) => n.nodeType === 1);
  const instance = new Component({});
  let queued = false;
  const paint = () => {
    queued = false;
    render(toVNode(rootNode, instance.renderVals(), 'r'), el);
  };
  instance._schedule = () => {
    if (!queued) {
      queued = true;
      queueMicrotask(paint);
    }
  };
  paint();
  instance.componentDidMount();
}
