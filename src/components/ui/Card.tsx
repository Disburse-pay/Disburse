import { forwardRef, type HTMLAttributes, type ElementType } from "react";
import { cn } from "../../lib/utils";

type Padding = "none" | "sm" | "md" | "lg";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  padding?: Padding;
};

const paddings: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { as: Tag = "section", padding = "md", className, children, ...rest },
  ref,
) {
  // Cast Tag to a generic element type so refs and props line up with the underlying element.
  const Component = Tag as ElementType;
  return (
    <Component
      ref={ref as never}
      className={cn(
        "rounded-[var(--card-radius)] border border-[var(--line)] bg-[var(--paper)]",
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
});

export default Card;
