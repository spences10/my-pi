import { mount } from 'svelte';
import './style.css';
import App from './app.svelte';

mount(App, { target: document.getElementById('app')! });
