const palettes = [
  {name:"Salt Canyon", type:"Desert study", colors:["#F4CD9B","#ED8C57","#CF6848","#934635","#45372F"]},
  {name:"Tidal Glass", type:"Coastal study", colors:["#DAE7DC","#F4C578","#95BDB4","#547F82","#294955"]},
  {name:"Alpine Dusk", type:"Mountain study", colors:["#DDD6EA","#F4B9A4","#A49EC0","#716F92","#36394C"]}
];
const choices = document.querySelector("#choices");
const swatches = document.querySelector("#swatches");
const scene = document.querySelector("#scene");
const feedback = document.querySelector("#feedback");
function selectPalette(index) {
  const palette = palettes[index];
  document.querySelector("#scene-title").textContent = palette.name;
  document.querySelector("#palette-title").textContent = palette.name;
  document.querySelector("#scene-type").textContent = palette.type;
  scene.setAttribute("aria-label", "Abstract landscape in the " + palette.name + " palette");
  Array.from(choices.children).forEach((btn,i) => btn.setAttribute("aria-pressed", String(i === index)));
  feedback.textContent = "";
  swatches.replaceChildren();
  palette.colors.forEach((hex,i) => {
    scene.style.setProperty("--c"+i,hex);
    const button = document.createElement("button");
    const sample = document.createElement("i");
    sample.style.background = hex;
    const code = document.createElement("code");
    code.textContent = hex;
    button.append(sample,code);
    button.setAttribute("aria-label","Copy " + hex);
    button.onclick = async () => {
      try { await navigator.clipboard.writeText(hex); feedback.textContent = "Copied " + hex; }
      catch { feedback.textContent = "Copy this color: " + hex; }
    };
    swatches.append(button);
  });
}
palettes.forEach((palette,i) => {
  const button = document.createElement("button");
  const dot = document.createElement("i");
  dot.style.background = palette.colors[2];
  button.append(dot,document.createTextNode(palette.name));
  button.onclick = () => selectPalette(i);
  choices.append(button);
});
selectPalette(0);
