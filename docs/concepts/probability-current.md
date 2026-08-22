# 概率流

无电磁矢势的 Schrödinger 粒子满足：

$$
\rho=|\psi|^2,
\qquad
\mathbf j=rac{\hbar}{\mu}\operatorname{Im}(\psi^*\nabla\psi),
$$

以及连续性方程：

$$
\boxed{
\frac{\partial\rho}{\partial t}+\nabla\cdot\mathbf j=0
}
$$

这是 QuViz 将静态“云图”扩展为动态概率输运的核心 [@griffiths2018qm; @probability-current-wikipedia]。

## 定态不代表概率流必为零

对标准复氢样轨道：

$$
\psi_{n\ell m}=R_{n\ell}(r)\Theta_{\ell m}(\theta)e^{im\phi},
$$

虽然 $|\psi|^2$ 不随时间变化，但：

$$
\boxed{
\mathbf j=rac{\hbar m}{\mu r\sin\theta}|\psi|^2\mathbf e_\phi
}
$$

因此：

- $m=+1$ 与 $m=-1$ 的密度相同；
- 概率流方向相反；
- 只画 $|\psi|^2$ 无法区分二者；
- 相位色和流线能够区分。

实球谐是 $m$ 与 $-m$ 的线性组合，定态波函数可取实，因此其概率流为零。

## 流线不是默认的电子轨迹

可以定义：

$$
\mathbf v=\frac{\mathbf j}{\rho},
$$

用它输运点云能构造满足连续性方程的动画。但默认名称应是 **probability-flow streamlines**，而不是“实验观察到的电子轨迹”。只有在明确采用 Bohm 解释时，才可赋予轨迹本体论含义。

## 数值注意事项

在节点附近 $\rho\to0$，$\mathbf j/\rho$ 可能奇异。实现必须：

- 设置密度遮罩；
- 不在节点上启动流线；
- 检查离散连续性残差；
- 有矢势时使用协变电流：

$$
\mathbf j=rac{1}{\mu}\operatorname{Re}\left[\psi^*(-i\hbar\nabla-q\mathbf A)\psi\right].
$$
