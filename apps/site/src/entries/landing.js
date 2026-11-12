import { mount } from '../runtime.js';
import template from '../pages/landing.template.html?raw';
import Component from '../pages/landing.component.js';

mount(template, Component, document.getElementById('root'));
