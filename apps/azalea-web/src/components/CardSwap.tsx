"use client";

import React, {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import gsap from "gsap";
import "./CardSwap.css";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  customClass?: string;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ customClass, className, ...rest }, ref) => (
    <div ref={ref} {...rest} className={`card ${customClass ?? ""} ${className ?? ""}`.trim()} />
  ),
);
Card.displayName = "Card";

type Easing = "linear" | "elastic";
type StackDirection = "up" | "down";

interface CardSwapProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  cardDistance?: number;
  verticalDistance?: number;
  stackDirection?: StackDirection;
  delay?: number;
  pauseOnHover?: boolean;
  onCardClick?: (idx: number) => void;
  skewAmount?: number;
  easing?: Easing;
  children: ReactNode;
}

const makeSlot = (
  i: number,
  distX: number,
  distY: number,
  total: number,
  stackDirection: StackDirection,
) => ({
  x: i * distX,
  y: stackDirection === "up" ? -i * distY : i * distY,
  z: -i * distX * 1.5,
  zIndex: total - i,
});

const placeNow = (
  el: HTMLElement,
  slot: ReturnType<typeof makeSlot>,
  skew: number,
) => {
  gsap.set(el, {
    x: slot.x,
    y: slot.y,
    z: slot.z,
    xPercent: -50,
    yPercent: -50,
    skewY: skew,
    transformOrigin: "center center",
    zIndex: slot.zIndex,
    force3D: true,
  });
};

export default function CardSwap({
  className = "",
  width = 500,
  height = 400,
  cardDistance = 60,
  verticalDistance = 70,
  stackDirection = "up",
  delay = 5000,
  pauseOnHover = false,
  onCardClick,
  skewAmount = 6,
  easing = "elastic",
  children,
}: CardSwapProps) {
  const config =
    easing === "elastic"
      ? {
          ease: "elastic.out(0.6,0.9)",
          durDrop: 2,
          durMove: 2,
          durReturn: 2,
          promoteOverlap: 0.9,
          returnDelay: 0.05,
        }
      : {
          ease: "power1.inOut",
          durDrop: 0.8,
          durMove: 0.8,
          durReturn: 0.8,
          promoteOverlap: 0.45,
          returnDelay: 0.2,
        };

  const childArr = useMemo(() => Children.toArray(children), [children]);
  const refs = useMemo(
    () => childArr.map(() => React.createRef<HTMLDivElement>()),
    [childArr.length],
  );

  const order = useRef(Array.from({ length: childArr.length }, (_, i) => i));
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const total = refs.length;
    refs.forEach((r, i) => {
      if (r.current) {
        placeNow(r.current, makeSlot(i, cardDistance, verticalDistance, total, stackDirection), skewAmount);
      }
    });

    const swap = () => {
      if (order.current.length < 2) return;

      const [front, ...rest] = order.current;
      const elFront = refs[front].current;
      if (!elFront) return;

      const tl = gsap.timeline();
      tlRef.current = tl;

      tl.to(elFront, {
        y: "+=500",
        duration: config.durDrop,
        ease: config.ease,
      });

      tl.addLabel("promote", `-=${config.durDrop * config.promoteOverlap}`);
      rest.forEach((idx, i) => {
        const el = refs[idx].current;
        if (!el) return;
        const slot = makeSlot(i, cardDistance, verticalDistance, refs.length, stackDirection);
        tl.set(el, { zIndex: slot.zIndex }, "promote");
        tl.to(
          el,
          {
            x: slot.x,
            y: slot.y,
            z: slot.z,
            duration: config.durMove,
            ease: config.ease,
          },
          `promote+=${i * 0.15}`,
        );
      });

      const backSlot = makeSlot(refs.length - 1, cardDistance, verticalDistance, refs.length, stackDirection);
      tl.addLabel("return", `promote+=${config.durMove * config.returnDelay}`);
      tl.call(() => {
        gsap.set(elFront, { zIndex: backSlot.zIndex });
      }, undefined, "return");
      tl.to(
        elFront,
        {
          x: backSlot.x,
          y: backSlot.y,
          z: backSlot.z,
          duration: config.durReturn,
          ease: config.ease,
        },
        "return",
      );

      tl.call(() => {
        order.current = [...rest, front];
      });
    };

    swap();
    intervalRef.current = setInterval(swap, delay);

    if (pauseOnHover && container.current) {
      const node = container.current;
      const pause = () => {
        tlRef.current?.pause();
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
      const resume = () => {
        tlRef.current?.play();
        intervalRef.current = setInterval(swap, delay);
      };
      node.addEventListener("mouseenter", pause);
      node.addEventListener("mouseleave", resume);
      return () => {
        node.removeEventListener("mouseenter", pause);
        node.removeEventListener("mouseleave", resume);
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cardDistance, verticalDistance, delay, pauseOnHover, skewAmount, easing, refs, stackDirection]);

  const rendered = childArr.map((child, i) => {
    if (!isValidElement(child)) return child;

    const element = child as ReactElement<Record<string, unknown>>;

    return cloneElement(element, {
      key: i,
      style: { width, height, ...(element.props.style as CSSProperties | undefined) },
      onClick: (e: React.MouseEvent<HTMLDivElement>) => {
        (element.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
        onCardClick?.(i);
      },
      ref: refs[i],
    });
  });

  return (
    <div
      ref={container}
      className={`card-swap-container ${className}`.trim()}
      style={{ width, height }}
    >
      {rendered}
    </div>
  );
}
