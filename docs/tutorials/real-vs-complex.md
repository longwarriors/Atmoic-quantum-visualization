# 实轨道与复轨道

## 复基：角动量本征态

$$
Y_\ell^m(\theta,\phi)\propto P_\ell^{|m|}(\cos\theta)e^{im\phi}.
$$

它是 $L^2$ 和 $L_z$ 的共同本征函数。对 $m\ne0$：

- 密度对 $\phi$ 常常不变；
- 相位沿方位角连续绕转；
- 存在方位概率流。

## 实基：化学定向轨道

常见 $p_x,p_y,p_z,d_{xy}$ 等是同一简并子空间中的实线性组合。例如：

$$
p_x\propto\frac{Y_1^{-1}-Y_1^{1}}{\sqrt2},
\qquad
p_y\propto\frac{i(Y_1^{-1}+Y_1^{1})}{\sqrt2}.
$$

!!! warning "磁量子数不是笛卡尔朝向标签"

    在复球谐基中：

    $$
    L_zY_\ell^m=\hbar mY_\ell^m,
    $$

    所以复基中的 $m$ 标记选定 $z$ 轴上的角动量本征值，而不是把轨道分别命名为 $x/y/z$ 朝向。$Y_\ell^{-m}$ 与 $Y_\ell^m$ 的密度相同，但方位相位绕转和概率流方向相反；常见的 $p_x,p_y$ 则是上式所示的实线性组合 [@dlmf-spherical-harmonics, eqs. 14.30.3, 14.30.6, and 14.30.11_5]。

    QuViz 在实基中保留带符号的 `m`，只是为了稳定索引 cosine/sine 型实球谐；当 $|m|>0$ 时，这个字段不表示一次 $L_z$ 测量的确定结果。FloatHeadPhysics 在 27:25--30:18 用“旋转节点”帮助记忆维数 $2\ell+1$，并明确称其为 hand-wavy intuition。这个类比不能用于把每个 $m$ 直接映射成一个实轨道朝向 [@floatheadphysics2025-orbitals, 27:25--30:18]。

它们的正负号适合用两种相位颜色显示，但不能把颜色说成“正负电荷”。颜色表示波函数相位相差 $\pi$。

## 前端推荐编码

### 实波函数

- 正相位：cyan；
- 负相位：violet/magenta；
- 透明度由密度或表面 Fresnel 控制；
- 图例明确写 `phase 0` 与 `phase π`。

### 复波函数

- 色相：$\arg\psi/(2\pi)$ 的周期映射；
- 亮度或透明度：$|\psi|$ 或 $|\psi|^2$；
- 色轮首尾必须连续，不能用普通 rainbow 线性色条制造相位断点。

## 基变换不是新物理

对于简并子空间，酉变换：

$$
\widetilde\phi_i=\sum_jU_{ij}\phi_j,
\qquad U^\dagger U=I,
$$

改变单个基函数的外观，却不改变该子空间本身。QuViz 因此把 `basis` 放进状态元数据，而不是把 $p_x$ 误当成新的量子数本征态。
