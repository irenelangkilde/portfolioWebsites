<script>

const themes = [
["#0077BE","#00A8E8","#E0F4FF","#003B5C","#FFFFFF"],
["#FF6B6B","#FFA07A","#FFE66D","#4ECDC4","#1A535C"],
["#2D6A4F","#52B788","#B7E4C7","#1B4332","#FFFFFF"],
["#5A189A","#9D4EDD","#E0AAFF","#240046","#FFFFFF"],
["#1E1E1E","#2D2D2D","#404040","#FFFFFF","#00D9FF"],
["#FF9B71","#FFCB9A","#FFF4E0","#D4A574","#333333"],
["#0F2027","#203A43","#D4AF37","#FFE082","#FFFFFF"],
["#06FFA5","#98FFD6","#E0FFF5","#037F5F","#1A1A1A"],
["#9B2226","#AE2012","#CA6702","#F4A261","#264653"],
["#B298DC","#D4C2FC","#F8F3FF","#6B4C9A","#333333"],
["#FF6F61","#FFA69E","#FFE5E2","#E76F51","#264653"],
["#2C3E50","#34495E","#1ABC9C","#16A085","#ECF0F1"],
["#8B4513","#D2691E","#F4A460","#FAF0E6","#2F1B0C"],
["#00B4D8","#0096C7","#023E8A","#CAF0F8","#03045E"],
["#000000","#333333","#666666","#999999","#FFFFFF"],
["#D90368","#F72585","#FF8DC7","#FFCCE1","#2B0B3F"],
["#EDC9AF","#E3B5A4","#CDA788","#564946","#F5F5DC"],
["#FF006E","#FB5607","#FFBE0B","#8338EC","#1A1A1D"],
["#C9E4E7","#A7C4CB","#FFFFFF","#6B9DAA","#003D54"],
["#FFB7C5","#FF9EAA","#FFF0F5","#E85D75","#7C2D41"]
];

const grid = document.getElementById("themeGrid");

themes.forEach((colors, i) => {

  const card = document.createElement("div");
  card.className = "theme-card";

  const row = document.createElement("div");
  row.className = "color-boxes";

  colors.forEach(c => {
    const b = document.createElement("div");
    b.className = "color-box";
    b.style.background = c;
    row.appendChild(b);
  });

  const label = document.createElement("div");
  label.className = "theme-name";
  label.textContent = "Theme " + (i+1);

  card.appendChild(label);
  card.appendChild(row);

  card.onclick = () => {

    const theme = {
      primary: colors[0],
      secondary: colors[1],
      accent: colors[2],
      dark: colors[3],
      light: colors[4]
    };

    window.parent.postMessage({
      type: "colorThemeSelected",
      number: i+1,
      theme: theme
    }, "*");

  };

  grid.appendChild(card);

});

</script>