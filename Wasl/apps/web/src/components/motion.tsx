'use client';
/** Presentation-only motion primitives. MotionConfig honours the OS reduced-motion setting. */
import { AnimatePresence, MotionConfig, animate, motion, useInView, useReducedMotion } from 'motion/react';
import type { HTMLMotionProps, Transition } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ease = [0.2, 0.8, 0.2, 1] as const;
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 26 };

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Keyed by route path only; locale changes never remount page content. */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        className="page-transition"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.32, ease }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease } },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, hover = true, ...rest }: HTMLMotionProps<'div'> & { hover?: boolean }) {
  return (
    <motion.div
      className={className}
      variants={item}
      whileHover={hover ? { y: -6, rotate: -0.4, transition: spring } : undefined}
      whileTap={hover ? { scale: 0.98 } : undefined}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Rises in on mount; used for heroes and panels. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Animates a real, already-loaded number. Renders the final value without motion when reduced. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration: 0.9, ease, onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduced, value]);
  return <span ref={ref}>{shown.toLocaleString()}</span>;
}

/** Shared-layout pill that glides between navigation items. */
export function NavIndicator() {
  return <motion.span layoutId="nav-indicator" className="nav-indicator" aria-hidden="true" transition={spring} />;
}

export { motion };
