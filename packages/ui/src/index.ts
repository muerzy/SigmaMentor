/** packages/ui 入口：shadcn 风格组件 + 会话上下文 + 视觉契约组件 */
export { cn } from "./lib/cn";
export { createApiClient, unwrap, type ApiClient } from "./lib/api";
export { Button } from "./components/button";
export { Badge, EventBadge, EVT_BADGE } from "./components/badge";
export { Sheet, SheetTrigger, SheetClose, SheetContent } from "./components/sheet";
export { Checkbox } from "./components/checkbox";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
export { ToastProvider, useToast, type ToastOptions } from "./components/toast";
export { AuthProvider, useAuth, type Me } from "./auth/auth-context";
export { Shell, PageHead, Card, Stat } from "./components/shell";
