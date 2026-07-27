import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
// Civitai design system — tokens + component CSS (bare-markup consumption).
// Order-locked by the @layer declaration at the top of app.css.
import '@civitai/theme/styles.css';
import '@civitai/components/styles.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app not found');

mount(App, { target });
