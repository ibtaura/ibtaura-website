// /attention-test/leaderboard: the full board (top 100, Global and Friends). The game page mounts the compact one.
import { mountBoard } from './board.js?v=5';

const el = document.getElementById('at-board');
if (el) mountBoard(el, { variant: 'full' });
