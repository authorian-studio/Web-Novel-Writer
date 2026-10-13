// Pengganti react/jsx-runtime: build UMD React 18 tidak membawanya, jadi jsx() diteruskan ke createElement
const R = window.React;
function jsx(type, props, key) {
  return R.createElement(type, key !== undefined ? Object.assign({}, props, { key: key }) : props);
}
module.exports = { jsx: jsx, jsxs: jsx, jsxDEV: jsx, Fragment: R.Fragment };
