import type { Transition, Variants } from "framer-motion";

// One easing curve and a few durations for the whole interface.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const TWEEN_FAST: Transition = { duration: 0.16, ease: EASE_OUT };
export const TWEEN_ENTER: Transition = { duration: 0.32, ease: EASE_OUT };

export const modalVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: TWEEN_ENTER },
  exit: { opacity: 0, y: 4, transition: { duration: 0.16, ease: EASE_OUT } },
};

export const drawerRightVariants: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: TWEEN_ENTER },
  exit: { opacity: 0, x: 16, transition: { duration: 0.18, ease: EASE_OUT } },
};

export const verificationListVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

export const verificationStepVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: TWEEN_ENTER },
};

export const attackShieldVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: TWEEN_ENTER },
};

export const lockSnapVariants: Variants = {
  idle: { opacity: 1 },
  signing: { opacity: 1 },
  signed: { opacity: 1 },
  failed: { opacity: 1 },
};

export const cosignAlertVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: TWEEN_ENTER },
  exit: { opacity: 0, y: 4, transition: { duration: 0.18, ease: EASE_OUT } },
};

// Use this for staggered variants in addition to the root MotionConfig.
export const reducedMotionVariants: Variants = {
  idle: { opacity: 1 },
  signing: { opacity: 1 },
  signed: { opacity: 1 },
  failed: { opacity: 1 },
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};
