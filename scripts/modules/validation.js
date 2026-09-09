export const MAX_INPUT_LENGTH = 65_536;
export const validInput = value => typeof value === "string" && value.length > 0 && value.length <= MAX_INPUT_LENGTH;
export const validSize = (cols, rows) => Number.isInteger(cols) && Number.isInteger(rows)
  && cols >= 1 && cols <= 500 && rows >= 1 && rows <= 200;
