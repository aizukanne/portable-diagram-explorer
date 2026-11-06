// Child runtime entry: runs inside the sandboxed iframe (design D16, D17).
import { buildInfo } from './build-info.js';

document.documentElement.setAttribute('data-pde-version', buildInfo().version || '');
