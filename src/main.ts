import { mount } from 'svelte';
import './ui/styles.css';
import AppUi from './ui/App.svelte';
import { App } from './app.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const labels = document.getElementById('labels') as HTMLElement;

// Pinch zoom belongs to the scene and the timeline, never the page: a pinch
// that lands just off the timeline track would otherwise zoom everything.
// Their own listeners run first, so they still get the gesture.
window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

mount(AppUi, { target: document.getElementById('ui')! });

const app = new App(canvas, labels);
void app.init();

// Handy for debugging from the console.
(window as unknown as { app: App }).app = app;
