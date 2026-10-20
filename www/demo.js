// Do not play the demo video by itself when the visitor asks for reduced motion.
const demo = document.querySelector('video[data-demo]');
if (demo && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  demo.removeAttribute('autoplay');
  demo.pause();
}
