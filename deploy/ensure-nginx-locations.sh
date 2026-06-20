#!/bin/bash
# 在 huawei2 以 root 运行: sudo bash ensure-nginx-locations.sh
# 幂等:为每个脚本确保 aurash-tunnel 里有精确 location(精确匹配优先于前缀 /,rebuild 不清掉)。
# 新增脚本时把文件名加进下面 SCRIPTS 数组再跑一次即可。
set -e
CONF=/etc/nginx/sites-available/aurash-tunnel
SCRIPTS=( feiyue-grinder.user.js feiyue-solver.user.js feiyue-importer.user.js )

[ -f "$CONF" ] || { echo "找不到 $CONF"; exit 1; }
changed=0
BAK="${CONF}.bak.$(date +%Y%m%d%H%M%S)"

for s in "${SCRIPTS[@]}"; do
  if grep -q "location = /$s" "$CONF"; then
    echo "  [skip] $s 已有 location"
  else
    [ "$changed" -eq 0 ] && cp "$CONF" "$BAK" && echo "已备份 -> $BAK"
    changed=1
    tmp=$(mktemp)
    awk -v s="$s" '
      /^[[:space:]]*location \/ \{/ && !ins {
        print "    location = /" s " { root /home/winbeau/public-scripts; default_type application/javascript; charset utf-8; add_header Cache-Control \"no-cache\"; }";
        ins=1
      }
      { print }
    ' "$CONF" > "$tmp" && mv "$tmp" "$CONF"
    echo "  [add]  location = /$s"
  fi
done

if [ "$changed" -eq 1 ]; then
  if nginx -t; then
    systemctl reload nginx 2>/dev/null || nginx -s reload
    echo "RELOAD_OK"
  else
    echo "!! nginx -t 失败,回滚 -> $BAK"; cp "$BAK" "$CONF"; exit 1
  fi
else
  echo "无需改动(所有 location 已存在)。"
fi
