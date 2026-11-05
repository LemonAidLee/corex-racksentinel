.macro crcb rd, rs1, rs2
    .insn r 0x33, 0, 0x40, \rd, \rs1, \rs2
.endm

.equ CMD_COUNTERS,            82
.equ CMD_SAMPLE,              90
.equ CMD_SET_CRIT,            67
.equ CMD_SET_TRIP_CURRENT,    72
.equ CMD_SET_WARM,            65
.equ CMD_SET_WARN_CURRENT,    70
.equ CMD_STAGE_HIGH,          64
.equ CMD_STATUS,              80
.equ DEF_CRIT,                0x140
.equ DEF_TRIP_CURRENT,        160
.equ DEF_VOLTAGE,             230
.equ DEF_WARM,                0x10e
.equ DEF_WARN_CURRENT,        128
.equ DMEM_BASE,               0x10010000
.equ GPIO_BASE,               0xf0000000
.equ GPIO_DATADIR,            8
.equ GPIO_DATAOUT,            0
.equ PIN_EPO,                 128
.equ PIN_FAN_BOOST,           16
.equ PIN_FAN_MAX,             32
.equ PIN_OVERLOAD,            64
.equ REPLY_BADCRC,            90
.equ REPLY_INVALID,           60
.equ REPLY_OK,                165
.equ RX_TIMEOUT_LOOPS,        0xbec000
.equ ST_CLASS,                44
.equ ST_CRC_REJECTS,          60
.equ ST_EPO,                  52
.equ ST_EPO_TRIPS,            76
.equ ST_GOT_CURRENT,          80
.equ ST_GOT_TEMP,             56
.equ ST_LATEST_CURRENT,       64
.equ ST_LATEST_TEMP,          40
.equ ST_OVERLOAD,             68
.equ ST_STAGE,                32
.equ ST_STAGE_PENDING,        36
.equ ST_THR_CRIT,             4
.equ ST_THR_WARM,             0
.equ ST_BTN_PREV,             0x54        # P0 level at the last poll (added)
.equ GPIO_DATAIN,             4
.equ PIN_RESET,               0x01        # P0: operator reset (added)
.equ ST_TRIP_CURRENT,         16
.equ ST_VOLTAGE,              8
.equ ST_WARN_CURRENT,         12
.equ ST_WORDS,                22
.equ UART_BASE,               0xf1000000
.equ UART_CONTROL,            8
.equ UART_RXDATA,             4
.equ UART_RXDONE,             2
.equ UART_TRANSMIT,           1
.equ UART_TXDATA,             0
.equ UART_TXDONE,             4

.globl _start
_start:
    la   s0, GPIO_BASE
    la   s1, UART_BASE
    li   s11, DMEM_BASE
    lw   t0, GPIO_DATADIR(s0)
    ori  t0, t0, 0xF0
    sw   t0, GPIO_DATADIR(s0)
    sw   zero, GPIO_DATAOUT(s0)
    mv   t0, s11
    li   t1, ST_WORDS
_boot_clear:
    sw   zero, 0(t0)
    addi t0, t0, 4
    addi t1, t1, -1
    bnez t1, _boot_clear
    li   t0, DEF_WARM
    sw   t0, ST_THR_WARM(s11)
    li   t0, DEF_CRIT
    sw   t0, ST_THR_CRIT(s11)
    li   t0, DEF_VOLTAGE
    sw   t0, ST_VOLTAGE(s11)
    li   t0, DEF_WARN_CURRENT
    sw   t0, ST_WARN_CURRENT(s11)
    li   t0, DEF_TRIP_CURRENT
    sw   t0, ST_TRIP_CURRENT(s11)
main_loop:
    jal  ra, rx_byte_wait
    mv   s2, a0
    li   t0, CMD_SAMPLE
    beq  s2, t0, cmd_sample_receive
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   s3, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   s4, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    slli a0, a0, 8
    or   s4, s4, a0
    li   t0, 0xFFFF
    crcb t0, s2, t0
    crcb t0, s3, t0
    bne  t0, s4, cmd_badcrc
    li   t0, CMD_STAGE_HIGH
    beq  s2, t0, cmd_stage
    li   t0, CMD_SET_WARM
    beq  s2, t0, cmd_set_warm
    li   t0, CMD_SET_CRIT
    beq  s2, t0, cmd_set_crit
    li   t0, CMD_SET_WARN_CURRENT
    beq  s2, t0, cmd_set_warn_current
    li   t0, CMD_SET_TRIP_CURRENT
    beq  s2, t0, cmd_set_trip_current
    li   t0, CMD_STATUS
    beq  s2, t0, cmd_status
    li   t0, CMD_COUNTERS
    beq  s2, t0, cmd_counters
    j    reply_invalid
cmd_sample_receive:
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   s3, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   s4, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   s5, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    mv   t5, a0
    jal  ra, rx_byte_timeout
    beqz a1, main_loop
    slli a0, a0, 8
    or   t5, t5, a0
    li   t0, 0xFFFF
    crcb t0, s2, t0
    crcb t0, s3, t0
    crcb t0, s4, t0
    crcb t0, s5, t0
    bne  t0, t5, cmd_badcrc
    j    cmd_sample_process
reply_ok:
    li   a0, REPLY_OK
    jal  ra, tx_byte
    j    main_loop
reply_invalid:
    li   a0, REPLY_INVALID
    jal  ra, tx_byte
    j    main_loop
cmd_badcrc:
    lw   t0, ST_CRC_REJECTS(s11)
    li   t1, 255
    bgeu t0, t1, _badcrc_reply
    addi t0, t0, 1
    sw   t0, ST_CRC_REJECTS(s11)
_badcrc_reply:
    li   a0, REPLY_BADCRC
    jal  ra, tx_byte
    j    main_loop
cmd_sample_process:
    li   t0, 180
    bltu s3, t0, reply_invalid
    li   t0, 255
    beq  s3, t0, reply_invalid
    beq  s4, t0, reply_invalid
    beqz s5, reply_invalid
    beq  s5, t0, reply_invalid
    sw   s3, ST_VOLTAGE(s11)
    sw   s4, ST_LATEST_CURRENT(s11)
    li   t0, 1
    sw   t0, ST_GOT_CURRENT(s11)
    lw   t0, ST_WARN_CURRENT(s11)
    sltu t1, s4, t0
    xori t1, t1, 1
    sw   t1, ST_OVERLOAD(s11)
    li   t0, 5
    mul  t1, s5, t0
    li   t2, 0
    lw   t0, ST_THR_WARM(s11)
    blt  t1, t0, _sm_class_done
    li   t2, 1
    lw   t0, ST_THR_CRIT(s11)
    bge  t0, t1, _sm_class_done
    li   t2, 3
_sm_class_done:
    sw   t2, ST_CLASS(s11)
    sw   s5, ST_LATEST_TEMP(s11)
    li   t0, 1
    sw   t0, ST_GOT_TEMP(s11)
    lw   t0, ST_TRIP_CURRENT(s11)
    bltu t0, s4, _sm_trip_epo
    lw   t0, ST_CLASS(s11)
    li   t1, 3
    beq  t0, t1, _sm_trip_epo
    j    _sm_update_outputs          # the EPO latches; only P0 clears it (check_reset)
_sm_trip_epo:
    lw   t0, ST_EPO(s11)
    bnez t0, _sm_update_outputs
    li   t0, 1
    sw   t0, ST_EPO(s11)
    lw   t0, ST_EPO_TRIPS(s11)
    li   t1, 255
    bgeu t0, t1, _sm_update_outputs
    addi t0, t0, 1
    sw   t0, ST_EPO_TRIPS(s11)
_sm_update_outputs:
    jal  ra, update_outputs
    j    reply_ok
cmd_stage:
    slli t0, s3, 8
    sw   t0, ST_STAGE(s11)
    li   t0, 1
    sw   t0, ST_STAGE_PENDING(s11)
    j    reply_ok
cmd_set_warm:
    li   s5, ST_THR_WARM
    j    set_threshold
cmd_set_crit:
    li   s5, ST_THR_CRIT
set_threshold:
    lw   t0, ST_STAGE_PENDING(s11)
    sw   zero, ST_STAGE_PENDING(s11)
    beqz t0, reply_invalid
    lw   t0, ST_STAGE(s11)
    or   t0, t0, s3
    lw   t1, ST_THR_WARM(s11)
    lw   t3, ST_THR_CRIT(s11)
    li   t4, ST_THR_WARM
    bne  s5, t4, _set_critical
    mv   t1, t0
    j    _set_check
_set_critical:
    mv   t3, t0
_set_check:
    bge  t1, t3, reply_invalid
    add  t4, s11, s5
    sw   t0, 0(t4)
    j    reply_ok
cmd_status:
    bnez s3, reply_invalid
    lw   t0, ST_CLASS(s11)
    lw   t1, ST_OVERLOAD(s11)
    slli t1, t1, 2
    or   t0, t0, t1
    lw   t1, ST_EPO(s11)
    slli t1, t1, 3
    or   t0, t0, t1
    lw   t1, ST_GOT_TEMP(s11)
    slli t1, t1, 6
    or   t0, t0, t1
    lw   t1, ST_STAGE_PENDING(s11)
    slli t1, t1, 7
    or   a0, t0, t1
    jal  ra, tx_byte
    lw   a0, ST_LATEST_TEMP(s11)
    jal  ra, tx_byte
    lw   a0, ST_LATEST_CURRENT(s11)
    jal  ra, tx_byte
    lw   a0, ST_EPO_TRIPS(s11)
    jal  ra, tx_byte
    j    main_loop
cmd_counters:
    bnez s3, reply_invalid
    lw   a0, ST_CRC_REJECTS(s11)
    jal  ra, tx_byte
    li   a0, 0
    jal  ra, tx_byte
    li   a0, 0
    jal  ra, tx_byte
    li   a0, 0
    jal  ra, tx_byte
    j    main_loop
cmd_set_warn_current:
    beqz s3, reply_invalid
    lw   t0, ST_TRIP_CURRENT(s11)
    bgeu s3, t0, reply_invalid
    sw   s3, ST_WARN_CURRENT(s11)
    lw   t0, ST_LATEST_CURRENT(s11)
    sltu t0, t0, s3
    xori t0, t0, 1
    sw   t0, ST_OVERLOAD(s11)
    jal  ra, update_outputs
    j    reply_ok
cmd_set_trip_current:
    li   t0, 255
    beq  s3, t0, reply_invalid
    lw   t0, ST_WARN_CURRENT(s11)
    bgeu t0, s3, reply_invalid
    sw   s3, ST_TRIP_CURRENT(s11)
    j    reply_ok
rx_byte_wait:
    mv   s10, ra
_rxw_loop:
    lw   t0, UART_CONTROL(s1)
    andi t0, t0, UART_RXDONE
    bnez t0, _rxw_got
    jal  ra, check_reset             # poll P0 while waiting for a packet
    j    _rxw_loop
_rxw_got:
    sw   zero, UART_CONTROL(s1)
    lw   a0, UART_RXDATA(s1)
    mv   ra, s10
    ret

# check_reset: a NEW press of P0 clears a latched EPO only when the temperature
# is Normal and the current is below the warning level. (uses t0, t1, a4, s9)
check_reset:
    mv   s9, ra
    lw   a4, GPIO_DATAIN(s0)
    andi a4, a4, PIN_RESET
    lw   t1, ST_BTN_PREV(s11)
    sw   a4, ST_BTN_PREV(s11)
    beqz a4, _cr_ret                 # not pressed
    bnez t1, _cr_ret                 # still held: not a new press
    lw   t0, ST_EPO(s11)
    beqz t0, _cr_ret                 # nothing to reset
    lw   t0, ST_CLASS(s11)
    bnez t0, _cr_ret                 # temperature not Normal
    lw   t0, ST_LATEST_CURRENT(s11)
    lw   t1, ST_WARN_CURRENT(s11)
    bgeu t0, t1, _cr_ret             # current at or above the warning level
    sw   zero, ST_EPO(s11)
    jal  ra, update_outputs
_cr_ret:
    mv   ra, s9
    ret
rx_byte_timeout:
    li   t1, RX_TIMEOUT_LOOPS
_rxt_loop:
    lw   t0, UART_CONTROL(s1)
    andi t0, t0, UART_RXDONE
    bnez t0, _rxt_got
    addi t1, t1, -1
    bnez t1, _rxt_loop
    li   a1, 0
    ret
_rxt_got:
    sw   zero, UART_CONTROL(s1)
    lw   a0, UART_RXDATA(s1)
    li   a1, 1
    ret
tx_byte:
    lw   t0, UART_CONTROL(s1)
    andi t0, t0, UART_TXDONE
    beqz t0, tx_byte
    sw   a0, UART_TXDATA(s1)
    lw   t0, UART_CONTROL(s1)
    ori  t0, t0, UART_TRANSMIT
    sw   t0, UART_CONTROL(s1)
    ret
update_outputs:
    li   t2, 0
    lw   t0, ST_CLASS(s11)
    beqz t0, _uo_current
    li   t2, PIN_FAN_BOOST
    li   t1, 1
    beq  t0, t1, _uo_current
    li   t2, PIN_FAN_MAX
_uo_current:
    lw   t1, ST_OVERLOAD(s11)
    beqz t1, _uo_epo
    ori  t2, t2, PIN_OVERLOAD
_uo_epo:
    lw   t1, ST_EPO(s11)
    beqz t1, _uo_write
    ori  t2, t2, PIN_EPO
_uo_write:
    sw   t2, GPIO_DATAOUT(s0)
    ret
