/* ============================================================
   SigmaMentor 原型 · 共享脚本
   顶栏导航挂载（学生端墨黑 / 教师端灰）/ Toast 主动干预 / 证据抽屉 / 工具函数
   ============================================================ */
(function () {
  "use strict";

  var NAV = {
    student: [
      { href: "assignment.html", id: "assignment", ni: "F1", label: "作业中心" },
      { href: "diagnosis.html", id: "diagnosis", ni: "F2", label: "卡点诊断" },
      { href: "tutor.html", id: "tutor", ni: "F3", label: "导师对话" },
    ],
    teacher: [
      { href: "dashboard.html", id: "dashboard", ni: "F6", label: "班级学情看板" },
      { href: "students.html", id: "students", ni: "F7", label: "高危名单" },
    ],
  };

  var USER = {
    student: { name: "李明", meta: "2025100317 · 计算机 2025-3 班" },
    teacher: { name: "杨老师", meta: "程序设计基础 · 主讲教师" },
  };

  /* ---------- 顶栏导航（替换 #nav-mount 挂载点，并落主题类） ---------- */
  function shell(role, active) {
    var mount = document.getElementById("nav-mount");
    document.body.classList.add(role === "teacher" ? "theme-gray" : "theme-dark");
    if (!mount) return;
    var items = NAV[role] || [];
    var user = USER[role] || { name: "", meta: "" };
    var roleZh = role === "teacher" ? "教师端" : "学生端";
    var html =
      '<header class="topnav" data-od-id="top-nav">' +
      '<a class="brand" href="../index.html" data-od-id="brand-home">' +
      '<span class="sig">SigmaMentor</span><span class="sub">2σ 导师</span></a>' +
      '<span class="role-tag">' + roleZh + "</span>" +
      '<nav aria-label="' + roleZh + '导航" data-od-id="top-nav-items">' +
      items
        .map(function (it) {
          return (
            '<a href="' + it.href + '" data-od-id="nav-' + it.id + '"' +
            (it.id === active ? ' class="active" aria-current="page"' : "") +
            "><span class=\"ni\">" + it.ni + "</span>" + it.label + "</a>"
          );
        })
        .join("") +
      "</nav>" +
      '<span class="nav-right">' +
      '<span class="u-meta">' + user.name + " · " + user.meta + "</span>" +
      '<a class="back" href="../index.html">返回总览</a>' +
      "</span>" +
      "</header>";
    mount.outerHTML = html;
  }

  /* ---------- Toast（导师主动干预等） ---------- */
  var toastTimer = null;
  function toast(opt) {
    var el = document.getElementById("sm-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "sm-toast";
      el.className = "toast";
      el.setAttribute("data-od-id", "intervention-toast");
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="t-k">' + (opt.kicker || "SigmaMentor") + "</div>" +
      '<div class="t-t">' + opt.title + "</div>" +
      (opt.body ? '<div class="t-d">' + opt.body + "</div>" : "") +
      (opt.actions
        ? '<div class="t-a">' +
          opt.actions
            .map(function (a) {
              return (
                '<a class="btn ' + (a.solid ? "solid" : "") + '" href="' + a.href + '">' + a.label + "</a>"
              );
            })
            .join("") +
          "</div>"
        : "");
    requestAnimationFrame(function () {
      el.classList.add("on");
    });
    if (toastTimer) clearTimeout(toastTimer);
    if (opt.duration !== 0) {
      toastTimer = setTimeout(function () {
        el.classList.remove("on");
      }, opt.duration || 9000);
    }
  }
  function toastClose() {
    var el = document.getElementById("sm-toast");
    if (el) el.classList.remove("on");
  }

  /* ---------- 证据抽屉 ---------- */
  function ensureDrawer() {
    if (document.getElementById("sm-drawer")) return;
    var veil = document.createElement("div");
    veil.id = "sm-drawer-veil";
    veil.className = "drawer-veil";
    veil.addEventListener("click", drawerClose);
    var d = document.createElement("div");
    d.id = "sm-drawer";
    d.className = "drawer";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-modal", "true");
    d.innerHTML =
      '<div class="drawer-h"><div class="drawer-t" id="sm-drawer-t"></div>' +
      '<button class="drawer-x" data-od-id="drawer-close">ESC 关闭</button></div>' +
      '<div class="drawer-b" id="sm-drawer-b"></div>';
    document.body.appendChild(veil);
    document.body.appendChild(d);
    d.querySelector(".drawer-x").addEventListener("click", drawerClose);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") drawerClose();
    });
  }
  var drawerLastFocus = null;
  function drawer(title, html) {
    ensureDrawer();
    document.getElementById("sm-drawer-t").innerHTML = title;
    document.getElementById("sm-drawer-b").innerHTML = html;
    document.getElementById("sm-drawer-veil").classList.add("on");
    document.getElementById("sm-drawer").classList.add("on");
    /* 焦点移入抽屉，键盘用户不至于留在触发元素上 */
    drawerLastFocus = document.activeElement;
    var x = document.getElementById("sm-drawer").querySelector(".drawer-x");
    if (x) x.focus();
  }
  function drawerClose() {
    var v = document.getElementById("sm-drawer-veil");
    var d = document.getElementById("sm-drawer");
    if (v) v.classList.remove("on");
    if (d) d.classList.remove("on");
    if (drawerLastFocus && document.contains(drawerLastFocus) && typeof drawerLastFocus.focus === "function") {
      drawerLastFocus.focus();
    }
    drawerLastFocus = null;
  }

  /* ---------- 工具 ---------- */
  function fmtInterval(ms) {
    if (ms < 1000) return ms + "ms";
    var s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m < 60) return r ? m + "分" + r + "秒" : m + "分钟";
    var h = Math.floor(m / 60);
    return h + "时" + (m % 60) + "分";
  }
  function fmtMin(m) {
    if (m < 60) return m + " 分钟";
    return Math.floor(m / 60) + " 时 " + (m % 60) + " 分";
  }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { /* 隐私模式等场景静默降级 */ }
    return null;
  }
  /* 事件徽章（submission_events → 颜色语义） */
  var EVT = {
    edit:     { label: "编辑",     cls: "b-mut" },
    compile:  { label: "编译错误", cls: "b-fail" },
    run:      { label: "运行错误", cls: "b-fail" },
    partial:  { label: "部分通过", cls: "b-warn" },
    pass:     { label: "通过",     cls: "b-pass" },
    drop:     { label: "放弃",     cls: "b-outline" },
  };
  function evtBadge(type) {
    var e = EVT[type] || { label: type, cls: "b-mut" };
    return '<span class="badge ' + e.cls + '">' + e.label + "</span>";
  }

  window.SM = {
    shell: shell,
    toast: toast,
    toastClose: toastClose,
    drawer: drawer,
    drawerClose: drawerClose,
    fmtInterval: fmtInterval,
    fmtMin: fmtMin,
    store: store,
    evtBadge: evtBadge,
    EVT: EVT,
  };
})();
