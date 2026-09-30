package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
)

// EncryptAES256GCM 함수는 헥사(Hex) 형태의 비밀키를 사용해 평문을 AES-256-GCM 알고리즘으로 암호화합니다.
func EncryptAES256GCM(plaintext string, secretKeyHex string) (string, error) {
	key, err := hex.DecodeString(secretKeyHex)
	if err != nil {
		return "", errors.New("유효하지 않은 비밀키 헥사 포맷입니다")
	}
	if len(key) != 32 {
		return "", errors.New("비밀키는 반드시 32바이트(64자 헥사)여야 합니다")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(ciphertext), nil
}

// DecryptAES256GCM 함수는 헥사 형태로 암호화된 문자열을 AES-256-GCM 알고리즘으로 복호화합니다.
func DecryptAES256GCM(ciphertextHex string, secretKeyHex string) (string, error) {
	key, err := hex.DecodeString(secretKeyHex)
	if err != nil {
		return "", errors.New("유효하지 않은 비밀키 헥사 포맷입니다")
	}
	if len(key) != 32 {
		return "", errors.New("비밀키는 반드시 32바이트(64자 헥사)여야 합니다")
	}

	data, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", errors.New("유효하지 않은 암호문 헥사 포맷입니다")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("암호문 길이가 너무 짧습니다")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
