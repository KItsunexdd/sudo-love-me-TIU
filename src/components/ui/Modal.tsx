"use client";

import { DialogSurface, type DialogProps } from "./DialogSurface";

export function Modal(props: DialogProps & { wide?: boolean }) {
  return <DialogSurface {...props} placement="center" />;
}
