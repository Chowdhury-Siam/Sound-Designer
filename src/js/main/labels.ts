import type { LabelColor } from "./types";

export const LABEL_COLORS: Array<{ id: LabelColor; label: string; value: string }> = [
  { id: "red", label: "Red", value: "#ff5f57" },
  { id: "orange", label: "Orange", value: "#ff9f2f" },
  { id: "yellow", label: "Yellow", value: "#ffd23f" },
  { id: "green", label: "Green", value: "#43c96b" },
  { id: "blue", label: "Blue", value: "#4598f7" },
  { id: "purple", label: "Purple", value: "#c85adb" },
  { id: "gray", label: "Gray", value: "#9c9c9c" },
];

export const displayLabelColor = (color?: LabelColor): LabelColor | undefined => color;

export const labelColorValue = (color?: LabelColor) =>
  LABEL_COLORS.find((item) => item.id === displayLabelColor(color))?.value || "transparent";

export const labelColorName = (color?: LabelColor) =>
  LABEL_COLORS.find((item) => item.id === displayLabelColor(color))?.label || "No label";

const LEGACY_LABEL_ORDER: LabelColor[] = ["red", "orange", "yellow", "green", "blue", "purple", "gray"];
export const labelColorOrder = (color?: LabelColor) => {
  const index = color ? LEGACY_LABEL_ORDER.indexOf(color) : -1;
  return index < 0 ? LEGACY_LABEL_ORDER.length : index;
};
