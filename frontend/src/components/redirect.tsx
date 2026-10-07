import { useLayoutEffect, useRef } from "react";
import { useRouter, type AnyRouter, type NavigateOptions, type RegisteredRouter } from "@tanstack/react-router";

// 渲染后只跳转一次。TanStack 的 <Navigate> 每次重绘都会再跳一次，
// 父组件在跳转加载期间重绘（研究上下文、地址订阅）时会陷入死循环，页面卡死。
export function Redirect<
  TRouter extends AnyRouter = RegisteredRouter,
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: NavigateOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>) {
  const router = useRouter();
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current) return;
    done.current = true;
    void router.navigate(props as NavigateOptions);
  });
  return null;
}
