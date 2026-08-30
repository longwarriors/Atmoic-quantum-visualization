# 概率流

无电磁矢势的 Schrödinger 粒子满足：

$$
\rho=|\psi|^2,
\qquad
\mathbf j=\frac{\hbar}{\mu}\operatorname{Im}(\psi^*\nabla\psi),
$$

以及连续性方程：

$$
\boxed{
\frac{\partial\rho}{\partial t}+\nabla\cdot\mathbf j=0
}
$$

这是 QuViz 将静态“云图”扩展为动态概率输运的核心。公式依据量子力学教材；Wikipedia 只作为术语入口 [@griffiths2018qm, problem 4.49, eqs. (4.220)--(4.221), pp. 187--188; @probability-current-wikipedia]。

## 定态不代表概率流必为零

对标准复氢样轨道：

$$
\psi_{n\ell m}=R_{n\ell}(r)\Theta_{\ell m}(\theta)e^{im\phi},
$$

虽然 $|\psi|^2$ 不随时间变化，但：

$$
\boxed{
\mathbf j=\frac{\hbar m}{\mu r\sin\theta}|\psi|^2\mathbf e_\phi
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

### 定态流线是精确的圆

对复球谐定态，密度在商中约掉：

$$
\mathbf v=\frac{\mathbf j}{\rho}
=\frac{\hbar m}{\mu r\sin\theta}\mathbf e_\phi
=\frac{\hbar m}{\mu}\frac{(-y,\,x,\,0)}{x^2+y^2}.
$$

所以在 $\rho>0$ 且 $s=\sqrt{x^2+y^2}>0$ 的区域，每条流线都是**柱半径 $s$ 与高度 $z$ 均为常数的圆**，绕 $z$ 轴角速度为 $\hbar m/(\mu s^2)$，弧长 $2\pi s$ 后闭合。QuViz 的内部计算使用原子单位，代码中的 $\hbar=1$；这里保留 $\hbar$，以免把原子单位公式误读成一般 SI 量纲公式。

这在工程上很有用：QuViz 的 RK4 积分器是为一般速度场写的，并不知道答案是圆，因此“积分结果保持 $s$ 与 $z$ 不变、并在解析周期后闭合”构成对**积分器与电流公式两者**的独立检验，而不是对任一方的复述。测试见 `tests/test_streamlines.py`。

一般的非定态叠加可以产生非方位速度分量，因此不再具有上述圆形不变量，瞬时流线也**未必**闭合；单项态、简并定态或保留轴对称性的叠加则是反例，不能笼统写成“叠加态流线都不闭合”。M1 对一般叠加采用三维密度加权播种，并分别检验定态与含时连续性残差。

## 数值注意事项

在节点附近 $\rho\to0$，$\mathbf j/\rho$ 可能奇异。实现必须：

- 设置随 Coulomb 密度尺度 $(Z/a_\mu)^3$ 协变的密度遮罩，而不是固定 ordinary-Bohr cutoff；
- 不在节点上启动流线；
- 用相对速度阈值停止积分，以稳定 `hypot` 归约计算向量长度，并在序列化时先按长度 $a_\mu/Z$、速度 $Z$ 无量纲化，避免极小但可表示的流在 norm 或固定小数位中被清零；
- 检查离散连续性残差；
- 有矢势时使用协变电流：

$$
\mathbf j=\frac{1}{\mu}\operatorname{Re}\left[\psi^*(-i\hbar\nabla-q\mathbf A)\psi\right].
$$
