import { themeQuartz } from "ag-grid-community";

/** AG Grid Theming API bridged to the Settlr surface tokens. */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: "transparent",
  foregroundColor: "#e9eef2",
  borderColor: "rgba(255,255,255,0.085)",
  chromeBackgroundColor: "transparent",
  headerBackgroundColor: "transparent",
  headerTextColor: "#6a7480",
  headerFontSize: 10.5,
  headerFontWeight: 560,
  fontSize: 12.5,
  fontFamily: '"Inter Variable", "Segoe UI", system-ui, sans-serif',
  rowHoverColor: "rgba(255,255,255,0.035)",
  selectedRowBackgroundColor: "rgba(70,227,162,0.08)",
  oddRowBackgroundColor: "rgba(255,255,255,0.012)",
  accentColor: "#46e3a2",
  checkboxCheckedColor: "#46e3a2",
  wrapperBorder: false,
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "transparent",
  menuBackgroundColor: "#0d1319",
  browserColorScheme: "dark",
} as never);
