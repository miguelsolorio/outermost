import { mount } from 'svelte';
import './ui/styles.css';
import AppUi from './ui/App.svelte';
import { App } from './app.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const labels = document.getElementById('labels') as HTMLElement;

mount(AppUi, { target: document.getElementById('ui')! });

const app = new App(canvas, labels);
void app.init();

// Handy for debugging from the console.
(window as unknown as { app: App }).app = app;
