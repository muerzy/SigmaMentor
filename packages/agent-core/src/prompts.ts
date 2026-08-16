/**
 * 四级苏格拉底引导提示词（L1–L4）——复赛开源「分级引导策略库」的种子。
 *
 * 每级标注教学策略依据（可解释性要求：每级提示标注教学策略依据）。
 * 规则版模板 + LLM 版 system prompt 双形态，口径一致。
 */

export interface LevelPrompt {
  level: 1 | 2 | 3 | 4;
  name: string;
  /** 升级条件（对人/对评审可解释） */
  escalateWhen: string;
  /** 规则版开场/主话术（按知识点 key 索引，generic 兜底） */
  ruleScripts: Record<string, string>;
  genericPool: string[];
  meta: string;
}

const GENERIC_BY_LEVEL: Record<number, string[]> = {
  1: [
    "先复述一遍：题目的输入是什么、期望输出是什么？用自己的话，一句话就够。",
    "你觉得问题出在计算过程里，还是结果的边界上？说说理由。",
    "手动算一遍最小的那个用例，你的代码在哪一步开始和期望不一样？",
  ],
  2: [
    "把你的思路说给我听，一步一步来——我只听，不判断对错。",
    "如果把输入换成一个更小的值，你的方法还成立吗？哪里会先崩？",
    "你上一版改了什么？那次改动让哪个用例变好了、哪个没变？",
  ],
  3: [
    "对照样例的结构，指出你的代码和它差在哪一处？只说一处。",
    "样例里那行关键语句，换成你的题目应该长什么样？口头描述，不写代码。",
    "样例解决的是同一类问题——它避开了你现在卡的点，你看出它是怎么避开的吗？",
  ],
};

export const LEVEL_PROMPTS: LevelPrompt[] = [
  {
    level: 1,
    name: "定向提示",
    escalateWhen: "默认起始级；学生 L1 后仍卡（同型错误再犯或明确求助）升级 L2",
    meta: "依据：维果茨基最近发展区 · 反馈发生在卡住的那一刻",
    ruleScripts: {
      "loop-boundary":
        "先别急着改代码。回答我一个问题：当 n = 5 时，你的循环一共执行几次？每次把几加进了结果里？把每一次加的数一个个说出来。",
      "accumulator-init":
        "先别改代码。回答我：你的累加开始之前，那个装结果的变量里装的是什么？它是从什么值开始累加的？",
      "output-format":
        "先看最小的用例：你的函数返回的值和期望值，用严格相等（===）比，是一样吗？注意类型。",
      generic: "先别急着改代码。用最小的用例手动跑一遍你的思路，从哪一步开始和期望不一样？",
    },
    genericPool: GENERIC_BY_LEVEL[1]!,
  },
  {
    level: 2,
    name: "策略提示",
    escalateWhen: "L1 后仍卡——对比样例，暴露差异",
    meta: "依据：对比样例 · 暴露边界差异",
    ruleScripts: {
      "loop-boundary":
        "好，再具体一层。对比两种边界写法：< 与 <=。取 n = 5，把两种写法各自取到的值一行行列出来——它们相差哪一项？题目要求加到 n−1，该用哪一种？",
      "accumulator-init":
        "对比两个版本：一个把变量初始化为 0，一个不初始化。不初始化时它里面是什么？每次累加会从什么开始？",
      "output-format": "对比 10 和 '10'：== 与 === 各判什么？判题用哪种？你的返回值是哪个类型？",
      generic: "把你的方法和「从最小情况逐步构造」的方法各说一遍——它们在哪一步分岔？",
    },
    genericPool: GENERIC_BY_LEVEL[2]!,
  },
  {
    level: 3,
    name: "同类样例",
    escalateWhen: "L2 后仍卡——结构相同、数据不同的解法（样例渐隐）",
    meta: "依据：worked example fading · 样例渐隐",
    ruleScripts: {
      "loop-boundary":
        "我们换一道结构相同、数据不同的题，你照着它的结构看自己的：读入 m，输出 1 到 m−2（含）的所有整数之和。这道题里 m−2 要被加进去，所以上界用「包含」的写法。回到你的题目：n−1 应该被加进去吗？——包含用 <=，不包含用 <。对照着改一个字符就够了。",
      "accumulator-init":
        "看一个同类样例：数苹果前先把篮子倒空（sum = 0），再一个个放进去。你的篮子在开始前倒空了吗？如果篮子里原本有东西，数出来的总数会怎样？",
      generic:
        "我给你一道同类题的完整思路（不是你这道题）：审题 → 找最小情况 → 写出第 i 步做什么 → 检查起点和终点。对照这个结构，你的卡点在第几步？",
    },
    genericPool: GENERIC_BY_LEVEL[3]!,
  },
  {
    level: 4,
    name: "复盘提炼",
    escalateWhen: "解题成功后触发——生成式复盘，结论回流诊断画像",
    meta: "依据：Generation Effect · 生成式复盘",
    ruleScripts: {},
    genericPool: [
      "用自己的话说说：这次错在哪一类问题上？",
      "如果给同学讲这道题最容易踩的坑，你会先提醒哪一点？",
    ],
  },
];

/** LLM 版 system prompt：红线 ① 写死在提示词层 */
export function tutorSystemPrompt(
  funcName: string,
  kpName: string,
  level: 1 | 2 | 3 | 4,
  problemTitle: string,
): string {
  const lp = LEVEL_PROMPTS[level - 1]!;
  return [
    "你是 SigmaMentor 的一对一编程导师（2σ 导师），用苏格拉底式提问引导学生自己解决卡点。",
    `当前题目：${problemTitle}。学生需要完成的函数名：${funcName}。`,
    `学生当前诊断卡点知识点：${kpName}。`,
    `当前引导级别：L${level} ${lp.name}。升级条件：${lp.escalateWhen}。教学依据：${lp.meta}。`,
    "",
    "【产品红线 · 最高优先级】",
    `1. 你在任何一级都绝不输出完整可提交代码——尤其禁止写出函数 ${funcName} 的实现或任何 3 行以上的代码块。`,
    "2. 你的回复是提问和口头提示，不是答案。可以引用单行表达式、可以说「包含用 <=，不包含用 <」这类规则。",
    "3. 学生索要代码时，温和拒绝并说明：直接给代码会让下次同类题仍卡在同一处（Generation Effect）。",
    "4. 不告知具体要改哪一个字符，除非是规则本身的陈述。",
    "",
    `输出要求：只用一两段中文提问（L${level} 风格），不超过 120 字，结尾是一个明确的、学生可回答的问题。`,
  ].join("\n");
}

export const REFUSAL_FIRST =
  "这条红线我不能破——直接给你可提交的完整代码，下次同类题你还是会卡在同一个地方（Generation Effect：自己生成的答案才记得牢）。但我可以把提示再往下拆一层。";

export const REFUSAL_AGAIN =
  "还是不行——任何一级都不给完整代码，这是产品设计而不是模型能力问题。试试回答我上面的问题，或者说「再提示一下」，我往下降一层难度。";

export const L4_ASK = "恭喜，是你自己改出来的。最后一问：用自己的话说说——这次错在哪一类问题上？";

export const SOLVED_EARLY =
  "很好，先确认一下：是在作业页用沙箱判题全部通过了吗？如果是，我们直接进入最后一环节。";

export const L4_DONE = (summary: string) =>
  `已记录：「${summary}」。这条复盘结论已回流你的诊断画像——下次同型错误出现前，提示会更早到来。`;
