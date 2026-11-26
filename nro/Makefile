# Vesper for kaiHEN — Switch 2 native hbmenu app (.nro)
# Build inside ounce-devkit Docker image:
#   ./build.sh
ifeq ($(strip $(DEVKITPRO)),)
$(error "Please set DEVKITPRO in your environment (build inside ounce-devkit Docker image)")
endif

TARGET  := vesper
BUILD   := build
PREFIX  := $(DEVKITPRO)/devkitA64/bin/aarch64-none-elf-
include $(DEVKITPRO)/libounce/switch2_cpu.mk

ARCH    := $(SWITCH2_CPU) -mtp=soft -fPIE
CFLAGS  := $(ARCH) -std=gnu11 -O2 -Wall -Wextra -Wno-unused-function -ffunction-sections -fdata-sections \
           -D__SWITCH__ -D__SWITCH2__ \
           -I$(DEVKITPRO)/portlibs/switch2/include -I$(DEVKITPRO)/libounce/include -Isource
LDFLAGS := $(ARCH) -specs=$(DEVKITPRO)/libounce/switch.specs -Wl,--gc-sections
LIBS    := -L$(DEVKITPRO)/portlibs/switch2/lib -L$(DEVKITPRO)/libounce/lib -lkaihen -lnx

SRCS    := source/main.c source/sd_scanner.c source/profile_manager.c source/kaihen_ro.c
OBJS    := $(patsubst source/%.c,$(BUILD)/%.o,$(SRCS))

all: $(TARGET).nro

$(BUILD):
	mkdir -p $@

$(BUILD)/%.o: source/%.c | $(BUILD)
	$(PREFIX)gcc $(CFLAGS) -c $< -o $@

$(BUILD)/$(TARGET).elf: $(OBJS)
	$(PREFIX)gcc $(LDFLAGS) $^ $(LIBS) -o $@

$(BUILD)/$(TARGET).nacp: | $(BUILD)
	$(DEVKITPRO)/tools/bin/nacptool --create "Vesper" "Vesper" "0.1.0-beta" $@

$(TARGET).nro: $(BUILD)/$(TARGET).elf $(BUILD)/$(TARGET).nacp
	$(DEVKITPRO)/tools/bin/elf2nro $< $@ --nacp=$(BUILD)/$(TARGET).nacp --icon=$(DEVKITPRO)/libounce/default_icon.jpg

clean:
	rm -rf $(BUILD) $(TARGET).nro

.PHONY: all clean
