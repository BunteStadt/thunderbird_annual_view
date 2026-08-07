import { mountAnnualView, type AnnualViewConfig } from "./annual-view";
import { start } from "@calendar-host";

const root = document.getElementById("root");
if (!root) throw new Error("Annual View root is missing.");

const hostStart = start as unknown as (root: Element, mount: (root: Element, config: AnnualViewConfig) => void) => void;
hostStart(root, (mountRoot, config) => mountAnnualView(mountRoot, config));