#include <iostream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <thread>
#include "portaudio.h"
#include "opus.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "portaudio_x64.lib")

#define SERVER_IP "172.25.144.42"
#define SERVER_PORT 50005
#define SAMPLE_RATE 48000
#define FRAME_SIZE 960
#define BUFFER_SIZE 4096

struct AudioData {
    PaStream* inputStream;   // ��������¼����
    PaStream* outputStream;  // ����������ţ�
    OpusEncoder* encoder;
    OpusDecoder* decoder;
    SOCKET sock;
    sockaddr_in serverAddr;
};

// ¼���ص�
static int recordCallback(const void* input, void* output, unsigned long frameCount,
    const PaStreamCallbackTimeInfo* timeInfo, PaStreamCallbackFlags statusFlags, void* userData) {
    AudioData* data = (AudioData*)userData;
    if (!data || !data->encoder) {
        std::cerr << "recordCallback: data �� encoder Ϊ�գ���������\n";
        return paContinue;
    }
    unsigned char encodedData[BUFFER_SIZE];
    int encodedBytes = opus_encode(data->encoder, (const opus_int16*)input, FRAME_SIZE, encodedData, BUFFER_SIZE);
    if (encodedBytes > 0) {
        sendto(data->sock, (char*)encodedData, encodedBytes, 0, (sockaddr*)&data->serverAddr, sizeof(data->serverAddr));
    }
    return paContinue;
}

// ��������������
void receiveThread(AudioData* data) {
    char recvBuffer[BUFFER_SIZE];
    opus_int16 decodedBuffer[FRAME_SIZE];
    sockaddr_in senderAddr;
    int senderLen = sizeof(senderAddr);
    while (true) {
        int received = recvfrom(data->sock, recvBuffer, BUFFER_SIZE, 0, (sockaddr*)&senderAddr, &senderLen);
        if (received > 0) {
            int decodedSamples = opus_decode(data->decoder, (unsigned char*)recvBuffer, received, decodedBuffer, FRAME_SIZE, 0);
            if (decodedSamples > 0) {
                PaError err = Pa_WriteStream(data->outputStream, decodedBuffer, decodedSamples);
                if (err != paNoError) {
                    std::cerr << "Pa_WriteStream ����: " << Pa_GetErrorText(err) << std::endl;
                }
            }
        }
    }
}

int main() {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    SOCKET sock = socket(AF_INET, SOCK_DGRAM, 0);
    sockaddr_in serverAddr = {};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(SERVER_PORT);
    inet_pton(AF_INET, SERVER_IP, &serverAddr.sin_addr);

    AudioData* data = new AudioData();

    // ��ʼ�� PortAudio
    PaError portAudioErr = Pa_Initialize();
    if (portAudioErr != paNoError) {
        std::cerr << "PortAudio ��ʼ��ʧ��: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // �������������¼����
    PaStreamParameters inputParams;
    inputParams.device = Pa_GetDefaultInputDevice();
    if (inputParams.device == paNoDevice) {
        std::cerr << "û�п��õ������豸" << std::endl;
        return -1;
    }
    inputParams.channelCount = 1;
    inputParams.sampleFormat = paInt16;
    inputParams.suggestedLatency = Pa_GetDeviceInfo(inputParams.device)->defaultLowInputLatency;
    inputParams.hostApiSpecificStreamInfo = nullptr;

    // ����������������ţ�
    PaStreamParameters outputParams;
    outputParams.device = Pa_GetDefaultOutputDevice();
    if (outputParams.device == paNoDevice) {
        std::cerr << "û�п��õ�����豸" << std::endl;
        return -1;
    }
    outputParams.channelCount = 1;
    outputParams.sampleFormat = paInt16;
    outputParams.suggestedLatency = Pa_GetDeviceInfo(outputParams.device)->defaultLowOutputLatency;
    outputParams.hostApiSpecificStreamInfo = nullptr;

    // ����������¼����
    portAudioErr = Pa_OpenStream(&data->inputStream, &inputParams, nullptr, SAMPLE_RATE, FRAME_SIZE, paClipOff, recordCallback, data);
    if (portAudioErr != paNoError) {
        std::cerr << "��������ʧ��: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // ������������ţ�
    portAudioErr = Pa_OpenStream(&data->outputStream, nullptr, &outputParams, SAMPLE_RATE, FRAME_SIZE, paClipOff, nullptr, nullptr);
    if (portAudioErr != paNoError) {
        std::cerr << "�������ʧ��: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // ������Ƶ��
    portAudioErr = Pa_StartStream(data->inputStream);
    if (portAudioErr != paNoError) {
        std::cerr << "����������ʧ��: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    portAudioErr = Pa_StartStream(data->outputStream);
    if (portAudioErr != paNoError) {
        std::cerr << "���������ʧ��: " << Pa_GetErrorText(portAudioErr) << std::endl;
        return -1;
    }

    // ��ʼ�� Opus
    int opusErr;
    data->encoder = opus_encoder_create(SAMPLE_RATE, 1, OPUS_APPLICATION_VOIP, &opusErr);
    if (opusErr != OPUS_OK) {
        std::cerr << "Opus ��������ʼ��ʧ��: " << opus_strerror(opusErr) << std::endl;
        return -1;
    }

    data->decoder = opus_decoder_create(SAMPLE_RATE, 1, &opusErr);
    if (opusErr != OPUS_OK) {
        std::cerr << "Opus ��������ʼ��ʧ��: " << opus_strerror(opusErr) << std::endl;
        return -1;
    }

    // �����������
    data->sock = sock;
    data->serverAddr = serverAddr;

    // ���������߳�
    std::thread recvThread(receiveThread, data);
    recvThread.detach();

    std::cout << "�������������ң��� Enter �˳�...\n";
    std::cin.get();

    // ������Դ
    Pa_StopStream(data->inputStream);
    Pa_StopStream(data->outputStream);
    Pa_CloseStream(data->inputStream);
    Pa_CloseStream(data->outputStream);
    Pa_Terminate();
    closesocket(sock);
    WSACleanup();
    opus_encoder_destroy(data->encoder);
    opus_decoder_destroy(data->decoder);
    delete data;
    return 0;
}