import { mountYearView, type YearViewConfig } from "./annual-view";
import { start } from "@calendar-host";

const root = document.getElementById("root");
if (!root) throw new Error("Year View root is missing.");

const hostStart = start as unknown as (root: Element, mount: (root: Element, config: YearViewConfig) => void) => void;
hostStart(root, (mountRoot, config) => mountYearView(mountRoot, config));