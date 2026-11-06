// Editor entry.
import { buildInfo } from './build-info.js';

document.documentElement.setAttribute('data-pde-version', buildInfo().version || '');
