// Long-lived port names, shared by the extension pages and the background
// worker. A port is used where a message cannot help: a page closing takes its
// last message with it, while its port always disconnects (workstream W).
//
// This lives on its own so neither side has to import the other's module for a
// string: the side panel would otherwise pull the worker's presence code into
// its bundle, and the worker would pull React.

/** The side panel holds this port open for as long as it is on screen. */
export const SIDEPANEL_PORT = 'sidepanel';
