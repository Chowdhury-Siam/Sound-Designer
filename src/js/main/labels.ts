import type { LabelColor } from "./types";

export const LABEL_COLORS: Array<{ id: LabelColor; label: string; value: string }> = [
  { id: "red", label: "Red", value: "#ff5f57" },
  { id: "orange", label: "Orange", value: "#ff9f2f" },
  { id: "yellow", label: "Yellow", value: "#ffd23f" },
  { id: "green", label: "Green", value: "#43c96b" },
  { id: "blue", label: "Blue", value: "#4598f7" },
  { id: "purple", label: "Purple", value: "#c85adb" },
  { id: "gray", label: "Gray", value: "#92949b" },
];

export const labelColorValue = (color?: LabelColor) =>
  LABEL_COLORS.find((item) => item.id === color)?.value || "transparent";

export const labelColorName = (color?: LabelColor) =>
  LABEL_COLORS.find((item) => item.id === color)?.label || "No label";

export const labelColorOrder = (color?: LabelColor) => {
  const index = LABEL_COLORS.findIndex((item) => item.id === color);
  return index < 0 ? LABEL_COLORS.length : index;
};
