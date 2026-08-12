import { useEffect, useRef, useState, type ReactNode } from "react";

export function ModeCard({ alt, children, className, image }: { alt: string; children: ReactNode; className: string; image: string }) {
    const cardRef = useRef<HTMLElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const card = cardRef.current;
        if (!card || !("IntersectionObserver" in globalThis)) {
            setIsVisible(true);
            return;
        }
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, { threshold: 0.18 });
        observer.observe(card);
        return () => observer.disconnect();
    }, []);

    return <figure ref={cardRef} className={`mode-card ${className}${isVisible ? " is-visible" : ""}`}><img src={image} alt={alt} loading="lazy" />{children}</figure>;
}