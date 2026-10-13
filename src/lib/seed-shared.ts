// Shared constants importable by both the seed script (tsx) and the app.
export const LOCAL_LEARNER_ID = "local-learner";

export type SeedSkill = {
  id: string;
  name: string;
  description: string;
  domain: string;
  category: string;
  difficulty: number;
  cognitiveLevel: string;
  prerequisites: string[];
};

// Re-export the canonical skill graph. Importing the full core module from a
// tsx seed is fine, but keeping a lean copy avoids pulling LLM/Prisma imports.
export const SKILLS: SeedSkill[] = [
  { id: "python.basics", name: "Python Basics", description: "Variables, primitive types, expressions and simple I/O.", domain: "programming", category: "concept", difficulty: 0.08, cognitiveLevel: "understand", prerequisites: [] },
  { id: "python.control_flow", name: "Control Flow", description: "Conditionals, loops, and iteration patterns.", domain: "programming", category: "skill", difficulty: 0.15, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.functions", name: "Functions", description: "Defining and calling functions, arguments, scope.", domain: "programming", category: "concept", difficulty: 0.18, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.return_values", name: "Return Values", description: "What a function returns vs. what it prints; None semantics.", domain: "programming", category: "subskill", difficulty: 0.24, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.strings", name: "Strings", description: "String indexing, slicing, and common methods.", domain: "programming", category: "skill", difficulty: 0.2, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.data_structures", name: "Lists & Dicts", description: "Lists, dictionaries, tuples and indexing semantics.", domain: "programming", category: "skill", difficulty: 0.26, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "python.comprehensions", name: "Comprehensions", description: "List and dict comprehensions as declarative iteration.", domain: "programming", category: "skill", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["python.data_structures", "python.control_flow"] },
  { id: "python.error_handling", name: "Error Handling", description: "Exceptions, try/except, and defensive coding.", domain: "programming", category: "skill", difficulty: 0.36, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.recursion", name: "Recursion", description: "Recursive functions, base cases, call stack.", domain: "programming", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["python.functions"] },
  { id: "python.oop", name: "Object-Oriented Programming", description: "Classes, instances, methods, and state.", domain: "programming", category: "concept", difficulty: 0.46, cognitiveLevel: "apply", prerequisites: ["python.functions", "python.data_structures"] },
  { id: "ds.arrays", name: "Arrays & Indexing", description: "Contiguous data, random access, boundaries.", domain: "data-structures", category: "concept", difficulty: 0.22, cognitiveLevel: "apply", prerequisites: ["python.basics"] },
  { id: "ds.hashmaps", name: "Hash Maps", description: "Key-value lookup, hashing, O(1) access.", domain: "data-structures", category: "concept", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["python.data_structures"] },
  { id: "ds.linked_lists", name: "Linked Lists", description: "Nodes, pointers, traversal and insertion.", domain: "data-structures", category: "concept", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["python.oop"] },
  { id: "ds.stacks_queues", name: "Stacks & Queues", description: "LIFO/FIFO and their use cases.", domain: "data-structures", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["ds.arrays"] },
  { id: "ds.trees", name: "Trees", description: "Binary trees, traversal, recursion on trees.", domain: "data-structures", category: "concept", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["ds.linked_lists", "python.recursion"] },
  { id: "ds.heaps", name: "Heaps", description: "Priority queues, heap property and operations.", domain: "data-structures", category: "concept", difficulty: 0.58, cognitiveLevel: "apply", prerequisites: ["ds.trees"] },
  { id: "ds.graphs", name: "Graphs", description: "Vertices, edges, adjacency representations.", domain: "data-structures", category: "concept", difficulty: 0.6, cognitiveLevel: "apply", prerequisites: ["ds.hashmaps", "ds.trees"] },
  { id: "algo.complexity", name: "Complexity Analysis", description: "Big-O notation, time and space trade-offs.", domain: "algorithms", category: "concept", difficulty: 0.28, cognitiveLevel: "analyze", prerequisites: ["python.basics"] },
  { id: "algo.searching", name: "Searching", description: "Linear and binary search, boundary handling.", domain: "algorithms", category: "skill", difficulty: 0.34, cognitiveLevel: "apply", prerequisites: ["ds.arrays", "algo.complexity"] },
  { id: "algo.two_pointers", name: "Two Pointers", description: "Sliding pointers to reduce quadratic scans.", domain: "algorithms", category: "skill", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["ds.arrays"] },
  { id: "algo.sorting", name: "Sorting", description: "Comparison sorts, merge/quick, stability.", domain: "algorithms", category: "skill", difficulty: 0.46, cognitiveLevel: "apply", prerequisites: ["ds.arrays", "algo.complexity"] },
  { id: "algo.recursion_dp", name: "Recursive Thinking", description: "Divide-and-conquer and recurrence relations.", domain: "algorithms", category: "concept", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["python.recursion", "algo.complexity"] },
  { id: "algo.greedy", name: "Greedy Algorithms", description: "Local optimal choices and when they fail.", domain: "algorithms", category: "skill", difficulty: 0.6, cognitiveLevel: "evaluate", prerequisites: ["algo.sorting"] },
  { id: "algo.dynamic_programming", name: "Dynamic Programming", description: "Optimal substructure, memoization, tabulation.", domain: "algorithms", category: "skill", difficulty: 0.68, cognitiveLevel: "create", prerequisites: ["algo.recursion_dp"] },
  { id: "algo.graph_algorithms", name: "Graph Algorithms", description: "BFS, DFS, connected components, cycle detection.", domain: "algorithms", category: "skill", difficulty: 0.62, cognitiveLevel: "apply", prerequisites: ["ds.graphs", "algo.complexity"] },
  { id: "algo.shortest_paths", name: "Shortest Paths", description: "Dijkstra and weighted pathfinding.", domain: "algorithms", category: "skill", difficulty: 0.72, cognitiveLevel: "apply", prerequisites: ["algo.graph_algorithms"] },
  { id: "math.algebra", name: "Algebra", description: "Variables, equations, and algebraic manipulation.", domain: "mathematics", category: "concept", difficulty: 0.1, cognitiveLevel: "apply", prerequisites: [] },
  { id: "math.functions", name: "Functions & Graphs", description: "Mappings, composition, rate of change.", domain: "mathematics", category: "concept", difficulty: 0.2, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.calculus", name: "Calculus", description: "Derivatives, integrals, and the chain rule.", domain: "mathematics", category: "concept", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["math.functions"] },
  { id: "math.linear_algebra", name: "Linear Algebra", description: "Vectors, matrices, and dot products.", domain: "mathematics", category: "concept", difficulty: 0.36, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.probability", name: "Probability", description: "Random variables, independence, expectation.", domain: "mathematics", category: "concept", difficulty: 0.38, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "math.optimization", name: "Optimization", description: "Gradients, minima, and gradient descent.", domain: "mathematics", category: "concept", difficulty: 0.55, cognitiveLevel: "apply", prerequisites: ["math.calculus", "math.linear_algebra"] },
  { id: "stats.descriptive", name: "Descriptive Statistics", description: "Mean, variance, distributions, visualization.", domain: "statistics", category: "concept", difficulty: 0.24, cognitiveLevel: "apply", prerequisites: ["math.algebra"] },
  { id: "stats.distributions", name: "Probability Distributions", description: "Normal, binomial, and sampling distributions.", domain: "statistics", category: "concept", difficulty: 0.42, cognitiveLevel: "apply", prerequisites: ["math.probability"] },
  { id: "stats.hypothesis", name: "Hypothesis Testing", description: "Null hypotheses, p-values, confidence intervals.", domain: "statistics", category: "concept", difficulty: 0.5, cognitiveLevel: "evaluate", prerequisites: ["stats.distributions"] },
  { id: "stats.regression", name: "Regression", description: "Linear models, coefficients, and residual analysis.", domain: "statistics", category: "skill", difficulty: 0.5, cognitiveLevel: "apply", prerequisites: ["math.linear_algebra", "stats.descriptive"] },
  { id: "stats.bayes", name: "Bayesian Thinking", description: "Priors, likelihood, and posterior updating.", domain: "statistics", category: "concept", difficulty: 0.56, cognitiveLevel: "evaluate", prerequisites: ["math.probability"] },
  { id: "ml.python_ml", name: "ML Tooling", description: "NumPy/Pandas basics for data manipulation.", domain: "machine-learning", category: "skill", difficulty: 0.3, cognitiveLevel: "apply", prerequisites: ["python.data_structures"] },
  { id: "ml.data_handling", name: "Data Handling", description: "Cleaning, splitting, and avoiding leakage.", domain: "machine-learning", category: "skill", difficulty: 0.4, cognitiveLevel: "apply", prerequisites: ["ml.python_ml"] },
  { id: "ml.supervised", name: "Supervised Learning", description: "Regression and classification from labeled data.", domain: "machine-learning", category: "concept", difficulty: 0.48, cognitiveLevel: "apply", prerequisites: ["stats.regression", "ml.python_ml"] },
  { id: "ml.model_evaluation", name: "Model Evaluation", description: "Precision, recall, ROC, and choosing metrics.", domain: "machine-learning", category: "skill", difficulty: 0.5, cognitiveLevel: "evaluate", prerequisites: ["stats.distributions", "ml.supervised"] },
  { id: "ml.overfitting", name: "Overfitting & Bias-Variance", description: "Generalization, regularization, bias-variance trade-off.", domain: "machine-learning", category: "concept", difficulty: 0.56, cognitiveLevel: "evaluate", prerequisites: ["ml.supervised", "ml.model_evaluation"] },
  { id: "ml.gradient_descent", name: "Gradient Descent", description: "Optimizing models with gradients and learning rates.", domain: "machine-learning", category: "concept", difficulty: 0.58, cognitiveLevel: "apply", prerequisites: ["math.optimization", "ml.supervised"] },
  { id: "ml.neural_networks", name: "Neural Networks", description: "Layers, activations, backpropagation.", domain: "machine-learning", category: "concept", difficulty: 0.66, cognitiveLevel: "apply", prerequisites: ["math.linear_algebra", "ml.gradient_descent"] },
  { id: "ml.unsupervised", name: "Unsupervised Learning", description: "Clustering and dimensionality reduction.", domain: "machine-learning", category: "concept", difficulty: 0.62, cognitiveLevel: "apply", prerequisites: ["ml.supervised"] },
];
