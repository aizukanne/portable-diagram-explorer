// Editor entry (spec §4 "Author a project"). Runs from file:// with no server.
import { EditorApp } from './editor/app.js';

new EditorApp(document.getElementById('pde-root'));
