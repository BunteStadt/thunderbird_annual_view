import type { ReactNode } from "react";

export type Navigate = (path: string) => void;

export function Link({ to, navigate, children, className = "" }: {
    to: string;
    navigate: Navigate;
    children: ReactNode;
    className?: string;
}) {
    return (
        <a
            href={to}
            className={className}
            onClick={(event) => {
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
                    event.preventDefault();
                    navigate(to);
                }
            }}
        >
            {children}
        </a>
    );
}