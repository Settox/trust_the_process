# Map Functionality Audit

## Node Creation
- **Function**: `addNode` (Line 1067)
  ```javascript
  function addNode(partial) {
    var node = { id: uid(), x: ..., y: ..., w: 230, h: 180, title: partial.title || "New Node", body: partial.body || "", source: partial.source || "" };
    currentPage().nodes.push(node);
    // ...
  }
  ```

## Node Properties
- **Title & Body**: Edited via `node-title` and `node-body` elements (Lines 1046-1050)
- **Source**: Rendered in `node-src` (Lines 1059-1065)
- **Color**: Set via `naColor` input (Lines 1841-1843)
- **Lock**: Toggle with `node-lock` button (Lines 1836-1840)

## Node Manipulation
- **Drag**: `bindDrag` function (Lines 1089-1091)
- **Resize**: `bindResize` function (Lines 1093-1095)
- **Link**: `bindLink` function (Lines 1096-1097)

## Node Styling
- **Bare Mode**: Toggle external frame (Line 1839)
- **Lock Style**: Visual indicator when locked (Line 1844)

## Connections
- **Add/Remove**: `addConnection` and `removeConnection` (Lines 1131-1132)
- **Label & Curve**: `connLabel` input and `connStraight` button (Lines 1127-1130)

## Pen Functionality
- **Tools**: Pen, Highlighter, Eraser (Lines 2120-2123)
- **Drawing**: `strokePath` and `strokeEl` (Lines 2100-2102)

## Multi-Selection
- **Selection Box**: Drag to select nodes (Lines 2370-2378)
- **Alignment Tools**: Align selected nodes (Lines 2383-2387)

## Mini-Map
- **Rendering**: `drawMini` function (Lines 2390-2395)
- **Interaction**: Click to pan (Lines 2396-2397)

## Other Features
- **Context Menu**: Node actions (Lines 1053-1055)
- **Search**: Node search functionality (Lines 1887-1890)
