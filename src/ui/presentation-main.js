// Presentation entry: the viewer over the embedded project (design D7).
import { buildInfo } from './build-info.js';

document.documentElement.setAttribute('data-pde-version', buildInfo().version || '');
