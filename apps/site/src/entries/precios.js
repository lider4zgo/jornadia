import { mount } from '../runtime.js';
import template from '../pages/precios.template.html?raw';
import Component from '../pages/precios.component.js';

mount(template, Component, document.getElementById('root'));
