// Apply persisted display preferences before first paint.
try {
  const theme = localStorage.getItem("towerforge:theme") || "dark";
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.setAttribute("data-density", localStorage.getItem("towerforge:density") || "comfortable");
  document.documentElement.setAttribute("data-sidebar", localStorage.getItem("towerforge:sidebar-collapsed") === "1" ? "collapsed" : "expanded");
} catch {
  document.documentElement.setAttribute("data-theme", "dark");
}
