// ─────────────────────────────────────────────────────────────
// Knowledge Graph — domain-independent structure, domain-specific data.
// This is the seed "prior" (§26–27). Learning evidence can refine it later.
// ─────────────────────────────────────────────────────────────

export type Domain = {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
};

export type SkillDef = {
  id: string;
  name: string;
  description: string;
  domain: string;
  category: "concept" | "skill" | "subskill";
  difficulty: number; // 0..1 static prior
  cognitiveLevel: string;
  prerequisites: string[];
};

export type MisconceptionDef = {
  code: string;
  name: string;
  description: string;
  affectedSkills: string[];
  trigger: string;
  correction: string;
  counterExample?: string;
};

export const DOMAINS: Domain[] = [
  { id: "programming", name: "Programming", description: "Python foundations and practical coding", icon: "⌘", color: "#7c6cff" },
  { id: "algorithms", name: "Algorithms", description: "Problem solving, complexity and techniques", icon: "◈", color: "#22d3ee" },
  { id: "data-structures", name: "Data Structures", description: "Organizing data for efficient access", icon: "▦", color: "#34d399" },
  { id: "mathematics", name: "Mathematics", description: "The language behind the models", icon: "∑", color: "#a79bff" },
  { id: "statistics", name: "Statistics", description: "Reasoning under uncertainty", icon: "σ", color: "#fbbf24" },
  { id: "machine-learning", name: "Machine Learning", description: "Systems that learn from data", icon: "◉", color: "#fb7185" },
];

export const SKILLS: SkillDef[] = [
  // ── Programming (Python) ─────────────────────────────────
  { id: "python.basics", name: "Python Basics", description: "Variables, primitive types, expressions and simple I/O.", domain: "programming", category: "concept", difficulty: 0.08, cognitiveLevel: "understand", prerequisites: [] },
  { id: "python.control_flow", name: "Control Flow", description: "Conditionals, loops, and iteration patterns.", domain: "programming", category: "skill", difficulty: 0.15, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.functions", name: "Functions", description: "Defining and calling functions, arguments, scope.", domain: "programming", category: "concept", difficulty: 0.18, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.return_values", name: "Return Values", description: "What a function returns vs. what it prints; `None` semantics.", domain: "programming", category: "subskill", difficulty: 0.24, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.strings", name: "Strings", description: "String indexing, slicing, and common methods.", domain: "programming", category: "skill", difficulty: 0.2, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.data_structures", name: "Lists & Dicts", description: "Lists, dictionaries, tuples and indexing semantics.", domain: "programming", category: "skill", difficulty: 0.26, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.comprehensions", name: "Comprehensions", description: "List and dict comprehensions as declarative iteration.", domain: "programming", category: "skill", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["python.data_structures", "python.control_flow"] },
  { id: "python.error_handling", name: "Error Handling", description: "Exceptions, try/except, and defensive coding.", domain: "programming", category: "skill", difficulty: 0.36, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.recursion", name: "Recursion", description: "Recursive functions, base cases, call stack.", domain: "programming", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.oop", name: "Object-Oriented Programming", description: "Classes, instances, methods, and state.", domain: "programming", category: "concept", difficulty: 0.46, cognitiveLevel: "apply", prerequisites: ["python.functions", "python.data_structures"] },

  // ── Data Structures ──────────────────────────────────────
  { id: "ds.arrays", name: "Arrays & Indexing", description: "Contiguous data, random access, boundaries.", domain: "data-structures", category: "concept", difficulty: 0.22, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "ds.hashmaps", name: "Hash Maps", description: "Key-value lookup, hashing, O(1) access.", domain: "data-structures", category: "concept", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["python.data_structures"] },
  { id: "ds.linked_lists", name: "Linked Lists", description: "Nodes, pointers, traversal and insertion.", domain: "data-structures", category: "concept", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["python.oop"] },
  { id: "ds.stacks_queues", name: "Stacks & Queues", description: "LIFO/FIFO and their use cases.", domain: "data-structures", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["ds.arrays"] },
  { id: "ds.trees", name: "Trees", description: "Binary trees, traversal, recursion on trees.", domain: "data-structures", category: "concept", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["ds.linked_lists", "python.recursion"] },
  { id: "ds.heaps", name: "Heaps", description: "Priority queues, heap property and operations.", domain: "data-structures", category: "concept", difficulty: 0.58, cognitiveLevel: "apply", prerequisites: ["ds.trees"] },
  { id: "ds.graphs", name: "Graphs", description: "Vertices, edges, adjacency representations.", domain: "data-structures", category: "concept", difficulty: 0.6, cognitiveLevel: "apply", prerequisites: ["ds.hashmaps", "ds.trees"] },

  // ── Algorithms ───────────────────────────────────────────
  { id: "algo.complexity", name: "Complexity Analysis", description: "Big-O notation, time and space trade-offs.", domain: "algorithms", category: "concept", difficulty: 0.28, cognitiveLevel: "analyze", prerequisites: ["python.basics"] },
  { id: "algo.searching", name: "Searching", description: "Linear and binary search, boundary handling.", domain: "algorithms", category: "skill", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["ds.arrays", "algo.complexity"] },
  { id: "algo.two_pointers", name: "Two Pointers", description: "Sliding pointers to reduce quadratic scans.", domain: "algorithms", category: "skill", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["ds.arrays"] },
  { id: "algo.sorting", name: "Sorting", description: "Comparison sorts, merge/quick, stability.", domain: "algorithms", category: "skill", difficulty: 0.46, cognitiveLevel: "apply", prerequisites: ["ds.arrays", "algo.complexity"] },
  { id: "algo.recursion_dp", name: "Recursive Thinking", description: "Divide-and-conquer and recurrence relations.", domain: "algorithms", category: "concept", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["python.recursion", "algo.complexity"] },
  { id: "algo.greedy", name: "Greedy Algorithms", description: "Local optimal choices and when they fail.", domain: "algorithms", category: "skill", difficulty: 0.6, cognitiveLevel: "evaluate", prerequisites: ["algo.sorting"] },
  { id: "algo.dynamic_programming", name: "Dynamic Programming", description: "Optimal substructure, memoization, tabulation.", domain: "algorithms", category: "skill", difficulty: 0.68, cognitiveLevel: "create", prerequisites: ["algo.recursion_dp"] },
  { id: "algo.graph_algorithms", name: "Graph Algorithms", description: "BFS, DFS, connected components, cycle detection.", domain: "algorithms", category: "skill", difficulty: 0.62, cognitiveLevel: "apply", prerequisites: ["ds.graphs", "algo.complexity"] },
  { id: "algo.shortest_paths", name: "Shortest Paths", description: "Dijkstra and weighted pathfinding.", domain: "algorithms", category: "skill", difficulty: 0.72, cognitiveLevel: "apply", prerequisites: ["algo.graph_algorithms"] },

  // ── Mathematics ──────────────────────────────────────────
  { id: "math.algebra", name: "Algebra", description: "Variables, equations, and algebraic manipulation.", domain: "mathematics", category: "concept", difficulty: 0.1, cognitiveLevel: "apply", prerequisites: [] },
  { id: "math.functions", name: "Functions & Graphs", description: "Mappings, composition, rate of change.", domain: "mathematics", category: "concept", difficulty: 0.2, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.calculus", name: "Calculus", description: "Derivatives, integrals, and the chain rule.", domain: "mathematics", category: "concept", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["math.functions"] },
  { id: "math.linear_algebra", name: "Linear Algebra", description: "Vectors, matrices, and dot products.", domain: "mathematics", category: "concept", difficulty: 0.36, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.probability", name: "Probability", description: "Random variables, independence, expectation.", domain: "mathematics", category: "concept", difficulty: 0.38, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.optimization", name: "Optimization", description: "Gradients, minima, and gradient descent.", domain: "mathematics", category: "concept", difficulty: 0.55, cognitiveLevel: "apply", prerequisites: ["math.calculus", "math.linear_algebra"] },

  // ── Statistics ───────────────────────────────────────────
  { id: "stats.descriptive", name: "Descriptive Statistics", description: "Mean, variance, distributions, visualization.", domain: "statistics", category: "concept", difficulty: 0.24, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "stats.distributions", name: "Probability Distributions", description: "Normal, binomial, and sampling distributions.", domain: "statistics", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["math.probability"] },
  { id: "stats.hypothesis", name: "Hypothesis Testing", description: "Null hypotheses, p-values, confidence intervals.", domain: "statistics", category: "concept", difficulty: 0.5, cognitiveLevel: "evaluate", prerequisites: ["stats.distributions"] },
  { id: "stats.regression", name: "Regression", description: "Linear models, coefficients, and residual analysis.", domain: "statistics", category: "skill", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["math.linear_algebra", "stats.descriptive"] },
  { id: "stats.bayes", name: "Bayesian Thinking", description: "Priors, likelihood, and posterior updating.", domain: "statistics", category: "concept", difficulty: 0.56, cognitiveLevel: "evaluate", prerequisites: ["math.probability"] },

  // ── Machine Learning ─────────────────────────────────────
  { id: "ml.python_ml", name: "ML Tooling", description: "NumPy/Pandas basics for data manipulation.", domain: "machine-learning", category: "skill", difficulty: 0.3, cognitiveLevel: "apply", prerequisites: ["python.data_structures"] },
  { id: "ml.data_handling", name: "Data Handling", description: "Cleaning, splitting, and avoiding leakage.", domain: "machine-learning", category: "skill", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["ml.python_ml"] },
  { id: "ml.supervised", name: "Supervised Learning", description: "Regression and classification from labeled data.", domain: "machine-learning", category: "concept", difficulty: 0.48, cognitiveLevel: "apply", prerequisites: ["stats.regression", "ml.python_ml"] },
  { id: "ml.model_evaluation", name: "Model Evaluation", description: "Precision, recall, ROC, and choosing metrics.", domain: "machine-learning", category: "skill", difficulty: 0.5, cognitiveLevel: "evaluate", prerequisites: ["stats.distributions", "ml.supervised"] },
  { id: "ml.overfitting", name: "Overfitting & Bias-Variance", description: "Generalization, regularization, bias-variance trade-off.", domain: "machine-learning", category: "concept", difficulty: 0.56, cognitiveLevel: "evaluate", prerequisites: ["ml.supervised", "ml.model_evaluation"] },
  { id: "ml.gradient_descent", name: "Gradient Descent", description: "Optimizing models with gradients and learning rates.", domain: "machine-learning", category: "concept", difficulty: 0.58, cognitiveLevel: "apply", prerequisites: ["math.optimization", "ml.supervised"] },
  { id: "ml.neural_networks", name: "Neural Networks", description: "Layers, activations, backpropagation.", domain: "machine-learning", category: "concept", difficulty: 0.66, cognitiveLevel: "apply", prerequisites: ["math.linear_algebra", "ml.gradient_descent"] },
  { id: "ml.unsupervised", name: "Unsupervised Learning", description: "Clustering and dimensionality reduction.", domain: "machine-learning", category: "concept", difficulty: 0.62, cognitiveLevel: "apply", prerequisites: ["ml.supervised"] },
];

export const MISCONCEPTION_CATALOG: MisconceptionDef[] = [
  { code: "missing-return", name: "Missing return", description: "A function that should return a value does not, so it yields `None`.", affectedSkills: ["python.return_values"], trigger: "Function returns None unexpectedly; confusion between print and return.", correction: "A function without a `return` statement implicitly returns `None`. `print` only displays a value — it does not produce a result the caller can use.", counterExample: "def add(a,b): print(a+b)  # caller gets None" },
  { code: "off-by-one", name: "Off-by-one error", description: "Loop or index boundaries are wrong by one (start, stop, or inclusive/exclusive confusion).", affectedSkills: ["algo.searching", "python.control_flow", "algo.two_pointers"], trigger: "IndexError on the last element, or a binary search that loops forever.", correction: "Check whether the boundary is inclusive or exclusive and trace the smallest and largest inputs explicitly." },
  { code: "wrong-base-case", name: "Wrong base case", description: "Recursive function lacks or misstates its stopping condition.", affectedSkills: ["python.recursion", "algo.recursion_dp"], trigger: "RecursionError: maximum recursion depth exceeded.", correction: "Every recursive function needs a base case that is reached for the smallest input and returns without recursing." },
  { code: "mutable-default", name: "Mutable default argument", description: "Using a mutable object (list/dict) as a default argument, shared across calls.", affectedSkills: ["python.functions"], trigger: "State leaks between function calls unexpectedly.", correction: "Default arguments are evaluated once at definition time. Use `None` and create the mutable object inside the function." },
  { code: "incorrect-complexity", name: "Wrong complexity claim", description: "Mis-judging time complexity, e.g. treating nested loops as O(n) or ignoring a hidden O(n) inside a loop.", affectedSkills: ["algo.complexity"], trigger: "Answer states the wrong Big-O for an algorithm.", correction: "Count the total work of every nested loop and every operation inside it, not just the number of loops." },
  { code: "list-dict-confusion", name: "List vs dict indexing", description: "Using a key where an index belongs or vice-versa.", affectedSkills: ["python.data_structures"], trigger: "KeyError or IndexError confusion between lists and dictionaries.", correction: "Lists are indexed by integer position; dictionaries are keyed by any hashable key." },
  { code: "correlation-causation", name: "Correlation ≠ causation", description: "Interpreting a statistical association as a causal relationship.", affectedSkills: ["stats.regression", "stats.hypothesis"], trigger: "Claiming 'X causes Y' purely because they move together.", correction: "Association can arise from confounding or chance. Causation requires controlled intervention or a valid identification strategy." },
  { code: "data-leakage", name: "Data leakage", description: "Using information from the test/validation set during training.", affectedSkills: ["ml.data_handling"], trigger: "Suspiciously high validation score; scaling/splitting done in the wrong order.", correction: "Any transformation that uses statistics of the data must be fit on the training split only, then applied to validation/test." },
  { code: "precision-recall-confusion", name: "Precision vs recall", description: "Confusing precision and recall, or ignoring the class imbalance that makes accuracy misleading.", affectedSkills: ["ml.model_evaluation"], trigger: "Wrong metric chosen for an imbalanced problem.", correction: "Precision = TP/(TP+FP); recall = TP/(TP+FN). For rare positives, accuracy can be high while recall is near zero." },
  { code: "overfitting-sign", name: "Overfitting", description: "Model memorizes training data and fails to generalize.", affectedSkills: ["ml.overfitting"], trigger: "High training score, low validation score.", correction: "Regularize, reduce complexity, add data, or use cross-validation to estimate generalization." },
  { code: "chain-rule", name: "Chain rule error", description: "Forgetting the inner derivative when differentiating compositions.", affectedSkills: ["math.calculus"], trigger: "Derivative of a composite function is missing the inner factor.", correction: "d/dx f(g(x)) = f'(g(x)) · g'(x)." },
  { code: "independence", name: "Independence assumption", description: "Multiplying probabilities as if events were independent when they are not.", affectedSkills: ["math.probability"], trigger: "P(A and B) computed as P(A)P(B) for dependent events.", correction: "P(A and B) = P(A)P(B|A); only factor into the product when events are truly independent." },
];

const byId = new Map(SKILLS.map((s) => [s.id, s]));

export function getSkill(id: string): SkillDef | undefined {
  return byId.get(id);
}

export function getSkillsByDomain(domain: string): SkillDef[] {
  return SKILLS.filter((s) => s.domain === domain);
}

export function skillLabel(id: string): string {
  return byId.get(id)?.name ?? id;
}

/** Transitive prerequisites (all ancestors) of a skill. */
export function ancestors(id: string): Set<string> {
  const out = new Set<string>();
  const walk = (sid: string) => {
    const s = byId.get(sid);
    if (!s) return;
    for (const p of s.prerequisites) {
      if (!out.has(p)) {
        out.add(p);
        walk(p);
      }
    }
  };
  walk(id);
  return out;
}

/** Stable topological order of the whole graph (prerequisites before dependents). */
export function topologicalOrder(): SkillDef[] {
  const visited = new Set<string>();
  const result: SkillDef[] = [];
  const visit = (s: SkillDef) => {
    if (visited.has(s.id)) return;
    visited.add(s.id);
    for (const p of s.prerequisites) {
      const ps = byId.get(p);
      if (ps) visit(ps);
    }
    result.push(s);
  };
  for (const s of SKILLS) visit(s);
  return result;
}

export function misconception(code: string): MisconceptionDef | undefined {
  return MISCONCEPTION_CATALOG.find((m) => m.code === code);
}
