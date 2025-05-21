package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/HelloSapiens/collectivus/synkronus-cli/internal/config"
	"github.com/HelloSapiens/collectivus/synkronus-cli/internal/utils"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var (
	cfgFile string
	rootCmd = &cobra.Command{
		Use:   "synk",
		Short: "Synkronus CLI - A command-line interface for the Synkronus API",
		Long: `Synkronus CLI is a command-line tool for interacting with the Synkronus API.
It provides functionality for authentication, sync operations, app bundle management, and more.`,
	}
)

// Execute executes the root command.
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	cobra.OnInitialize(initConfig)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.synkronus.yaml)")
	rootCmd.PersistentFlags().String("api-url", "http://localhost:8080", "Synkronus API URL")
	rootCmd.PersistentFlags().String("api-version", "1.0.0", "API version to use")

	viper.BindPFlag("api.url", rootCmd.PersistentFlags().Lookup("api-url"))
	viper.BindPFlag("api.version", rootCmd.PersistentFlags().Lookup("api-version"))

	// Apply colored help template
	utils.SetupColoredHelp(rootCmd)
}

func initConfig() {
	if cfgFile != "" {
		// Use config file from the flag
		viper.SetConfigFile(cfgFile)
	} else {
		// Find home directory
		home, err := os.UserHomeDir()
		cobra.CheckErr(err)

		// Search config in home directory with name ".synkronus" (without extension)
		viper.AddConfigPath(home)
		viper.SetConfigType("yaml")
		viper.SetConfigName(".synkronus")

		// Also look for config in the current directory
		viper.AddConfigPath(".")
	}

	// Read in environment variables that match
	viper.AutomaticEnv()

	// If a config file is found, read it in
	if err := viper.ReadInConfig(); err == nil {
		fmt.Printf("Using config file: %s\n", viper.ConfigFileUsed())
	} else {
		// Create default config if it doesn't exist
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			defaultConfig := config.DefaultConfig()
			configDir := filepath.Dir(filepath.Join(os.Getenv("HOME"), ".synkronus.yaml"))
			if _, err := os.Stat(configDir); os.IsNotExist(err) {
				os.MkdirAll(configDir, 0755)
			}
			viper.SetConfigFile(filepath.Join(os.Getenv("HOME"), ".synkronus.yaml"))
			for k, v := range defaultConfig {
				viper.Set(k, v)
			}
			viper.WriteConfig()
		}
	}
}
