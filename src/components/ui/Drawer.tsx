"use client";

import { DialogSurface, type DialogProps } from "./DialogSurface";

export function Drawer(props: DialogProps) {
  return <DialogSurface {...props} placement="right" />;
}
