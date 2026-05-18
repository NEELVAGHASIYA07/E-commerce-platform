document.addEventListener("DOMContentLoaded", () => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.getElementById("siteMotionBadge")) return;

  const badge = document.createElement("div");
  badge.id = "siteMotionBadge";
  badge.innerHTML = `
    <span class="site-motion-badge__glow" aria-hidden="true"></span>
    <span class="site-motion-badge__menu" aria-hidden="true">Menu</span>
    <span class="site-motion-badge__line" aria-hidden="true"></span>
  `;
  badge.setAttribute("aria-hidden", "true");
  document.body.appendChild(badge);
});
