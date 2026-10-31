import { mount } from 'svelte';
import App from './app.svelte';
import './layout.css';
import { theme } from '#lib/theme.svelte.js';

// Set the theme class before the first paint.
theme.apply();

mount(App, { target: document.getElementById('app')! });
