import type { Transition, Variants } from "framer-motion";

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.8,
};

export const SPRING_SMOOTH: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 26,
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 6,
    transition: { duration: 0.16, ease: "easeIn" },
  },
};

export const drawerRightVariants: Variants = {
  hidden: { x: "100%", opacity: 0.6 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    x: "100%",
    opacity: 0.6,
    transition: { duration: 0.2, ease: "easeIn" },
  },
};

export const verificationListVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.075,
      delayChildren: 0.04,
    },
  },
};

export const verificationStepVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  },
};

export const attackShieldVariants: Variants = {
  hidden: { opacity: 0, scale: 0.93 },
  visible: {
    opacity: 1,
    scale: 1,
    x: [0, -6, 6, -4, 4, 0],
    transition: {
      opacity: { duration: 0.18 },
      scale: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
      x: { duration: 0.34, delay: 0.08, ease: "easeInOut" },
    },
  },
};

export const lockSnapVariants: Variants = {
  idle: { scale: 1 },
  signing: {
    scale: [1, 1.05, 1],
    transition: { repeat: Infinity, duration: 1.3, ease: "easeInOut" },
  },
  signed: {
    scale: [1.12, 1],
    transition: SPRING_SNAPPY,
  },
  failed: {
    x: [0, -5, 5, -3, 0],
    transition: { duration: 0.3 },
  },
};

export const cosignAlertVariants: Variants = {
  hidden: { opacity: 0, y: -20, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: SPRING_SMOOTH,
  },
  exit: {
    opacity: 0,
    y: 12,
    transition: { duration: 0.18 },
  },
};

// Use this for looping or staggered variants in addition to the root MotionConfig.
export const reducedMotionVariants: Variants = {
  idle: { opacity: 1 },
  signing: { opacity: 1 },
  signed: { opacity: 1 },
  failed: { opacity: 1 },
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};
