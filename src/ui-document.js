export function uiDocument({html, script, css, katexCss, base, channel}) {
  html = html.replace('<head>', () => '<head><base href="' + base.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '">');
  html = html.replace('<link rel="stylesheet" href="katex.css">', () => '<style>' + katexCss + '</style>')
    .replace('<link rel="stylesheet" href="ui.css">', () => '<style>' + css + '</style>');
  return html.replace('<script src="ui.js"></script>', () => '<script>window.NOTE_CHAT_CHANNEL=' + JSON.stringify(channel) + ';\n' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
}
