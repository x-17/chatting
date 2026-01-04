# 📘 接口文档：上传订单报价信息并签署

## 🧩 接口基本信息

| 项目         | 内容                                                         |
| ------------ | ------------------------------------------------------------ |
| **接口名称** | 上传订单报价信息并签署                                       |
| **接口路径** | `/uploadOrderQuote`                                          |
| **请求方法** | `POST`                                                       |
| **请求类型** | `multipart/form-data` 或 `application/x-www-form-urlencoded`（表单上传） |
| **接口说明** | 前端在合同签署前上传订单报价信息，后端接收、校验、写入数据库并创建签署记录。 |

------

## 🧾 请求头（Headers）

| 参数名  | 类型     | 是否必填 | 示例值                                    | 说明                                     |
| ------- | -------- | -------- | ----------------------------------------- | ---------------------------------------- |
| `token` | `String` | ✅ 是     | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | 用户登录后签发的 JWT，用于验证租户信息。 |

------

## 📥 请求体参数（Form 表单字段）

| 参数名           | 类型      | 是否必填 | 示例值                | 说明                             |
| ---------------- | --------- | -------- | --------------------- | -------------------------------- |
| `orderId`        | `String`  | ✅ 是     | `ORD-20251115001`     | 订单编号，唯一标识一笔订单。     |
| `amount`         | `Double`  | ✅ 是     | `1299.99`             | 订单对应的购买金额。             |
| `usagePeriod`    | `Integer` | ✅ 是     | `12`                  | 数据使用期限（单位：月）。       |
| `usageStartTime` | `Date`    | ✅ 是     | `2025-11-15 00:00:00` | 数据使用开始时间。               |
| `usageEndTime`   | `Date`    | ✅ 是     | `2026-11-14 23:59:59` | 数据使用结束时间。               |
| `fileId`         | `Integer` | ✅ 是     | `321`                 | 上传的合同文件在系统中的 ID。    |
| `signature`      | `String`  | ✅ 是     | `签署字符串`          | 客户端生成的电子签名或签署标识。 |

------

## 🧮 请求示例

### ✅ 表单请求示例（HTTP）

```
POST /uploadOrderQuote HTTP/1.1
Host: api.example.com
Content-Type: multipart/form-data
token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

orderId=ORD-20251115001
amount=1999.00
usagePeriod=6
usageStartTime=2025-11-15 00:00:00
usageEndTime=2026-05-14 23:59:59
fileId=88
signature=9f8a5b9c1e43b7c9
```

------

## 📤 响应格式

### ✅ 统一响应结构（`Result`）

```
public class Result {
    private Integer code;  // 响应码：1=成功，0=失败
    private String msg;    // 响应信息
    private Object data;   // 数据内容
}
```

------

### ✅ 成功响应示例

```
{
  "code": 1,
  "msg": "success",
  "data": "上传信息并签署成功"
}
```

------

### ⚠️ 参数校验失败示例

```
{
  "code": 0,
  "msg": "error",
  "data": "usageStartTime不能为空"
}
```

------

### ⚠️ 业务冲突（已存在生效报价）

```
{
  "code": 0,
  "msg": "error",
  "data": "当前订单已有生效报价，请刷新后重试"
}
```

------

### ⚠️ 系统异常示例

```
{
  "code": 0,
  "msg": "error",
  "data": "上传信息并签署异常，请稍后重试"
}
```